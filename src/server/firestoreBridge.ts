import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ChatMessage, WhatsAppConversation, WhatsAppIntegrationLog } from '../types';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedToken: { token: string; expiresAt: number; mode: 'service_account' | 'metadata_adc' } | null = null;

function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  cachedConfig = {
    projectId: String(raw.projectId || '').trim(),
    firestoreDatabaseId: String(raw.firestoreDatabaseId || '(default)').trim()
  };
  return cachedConfig;
}

function getServiceAccountFromEnv(): ServiceAccountCreds | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed?.client_email && parsed?.private_key) {
      return {
        client_email: String(parsed.client_email),
        private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
        token_uri: parsed.token_uri ? String(parsed.token_uri) : 'https://oauth2.googleapis.com/token'
      };
    }
  } catch {
    // ignore malformed service account JSON
  }
  return null;
}

async function getServerGoogleAccessToken(): Promise<{
  token: string;
  mode: 'service_account' | 'metadata_adc';
} | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { token: cachedToken.token, mode: cachedToken.mode };
  }

  const sa = getServiceAccountFromEnv();
  if (sa) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: sa.client_email,
          sub: sa.client_email,
          aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
          scope: 'https://www.googleapis.com/auth/datastore',
          iat: now,
          exp: now + 3600
        })
      ).toString('base64url');
      const signingInput = `${header}.${payload}`;
      const sig = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key, 'base64url');
      const jwt = `${signingInput}.${sig}`;

      const resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        }),
        signal: AbortSignal.timeout(5000)
      });
      const json: any = await resp.json();
      if (resp.ok && json?.access_token) {
        cachedToken = {
          token: String(json.access_token),
          expiresAt: Date.now() + (Number(json.expires_in) || 3500) * 1000,
          mode: 'service_account'
        };
        return { token: cachedToken.token, mode: cachedToken.mode };
      }
    } catch {
      // fall through to metadata server
    }
  }

  try {
    const metaResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500)
      }
    );
    if (metaResp.ok) {
      const metaJson: any = await metaResp.json();
      if (metaJson?.access_token) {
        cachedToken = {
          token: String(metaJson.access_token),
          expiresAt: Date.now() + (Number(metaJson.expires_in) || 3000) * 1000,
          mode: 'metadata_adc'
        };
        return { token: cachedToken.token, mode: cachedToken.mode };
      }
    }
  } catch {
    // Metadata server unavailable outside GCP
  }

  return null;
}

function toFirestoreValue(val: unknown): Record<string, any> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, any>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function sanitizeFsId(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

function firestoreDocumentsBase(): string {
  const cfg = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    cfg.projectId
  )}/databases/${encodeURIComponent(cfg.firestoreDatabaseId)}/documents`;
}

async function patchFirestoreDoc(
  docPath: string,
  fields: Record<string, any>,
  accessToken: string,
  createOnly?: boolean
): Promise<{ ok: boolean; status: number; error?: string }> {
  const base = firestoreDocumentsBase();
  const params = new URLSearchParams();
  for (const key of Object.keys(fields)) {
    params.append('updateMask.fieldPaths', key);
  }
  if (createOnly) {
    params.set('currentDocument.exists', 'false');
  }
  const url = `${base}/${docPath}?${params.toString()}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
    signal: AbortSignal.timeout(5000)
  });

  if (resp.ok) {
    return { ok: true, status: resp.status };
  }
  const errText = await resp.text().catch(() => '');
  // ALREADY_EXISTS (409) on createOnly is expected and idempotent
  if (createOnly && resp.status === 409) {
    return { ok: true, status: 409 };
  }
  return { ok: false, status: resp.status, error: errText.slice(0, 240) };
}

export async function testBackendFirestoreAccess(workspaceId?: string): Promise<{
  ok: boolean;
  authMode: 'service_account' | 'metadata_adc' | 'none';
  httpStatus?: number;
  detail: string;
}> {
  const auth = await getServerGoogleAccessToken();
  if (!auth) {
    return {
      ok: false,
      authMode: 'none',
      detail: 'Sem credenciais IAM de servidor (FIREBASE_SERVICE_ACCOUNT_JSON ausente e metadata server indisponível).'
    };
  }
  const base = firestoreDocumentsBase();
  const target = workspaceId
    ? `${base}/workspaces/${encodeURIComponent(workspaceId)}`
    : `${base}/workspaces?pageSize=1`;
  try {
    const r = await fetch(target, {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(4000)
    });
    if (r.ok || r.status === 404) {
      return {
        ok: true,
        authMode: auth.mode,
        httpStatus: r.status,
        detail: `Acesso REST ao Firestore autenticado (${auth.mode}, HTTP ${r.status}).`
      };
    }
    const errTxt = await r.text().catch(() => '');
    return {
      ok: false,
      authMode: auth.mode,
      httpStatus: r.status,
      detail: `Firestore REST retornou HTTP ${r.status}: ${errTxt.slice(0, 180) || 'PERMISSION_DENIED'}`
    };
  } catch (err: any) {
    return {
      ok: false,
      authMode: auth.mode,
      detail: `Falha de rede ao consultar Firestore REST: ${err?.message || 'erro desconhecido'}`
    };
  }
}

export async function persistWhatsAppEventToFirestore(params: {
  workspaceId?: string;
  conversation: WhatsAppConversation;
  message?: ChatMessage;
  logEntry?: WhatsAppIntegrationLog;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const workspaceId = (params.workspaceId || '').trim();
  if (!workspaceId) {
    return { ok: false, skipped: true, reason: 'Workspace Firebase UID ainda não vinculado no backend.' };
  }

  const auth = await getServerGoogleAccessToken();
  if (!auth) {
    return { ok: false, skipped: true, reason: 'Sem credenciais IAM de servidor para escrita direta no Firestore.' };
  }

  const nowDate = new Date();
  const conv = params.conversation;
  const convId = sanitizeFsId(conv.id);
  const normPhone = String(conv.contactPhone || '').replace(/\D/g, '').slice(0, 32) || convId;
  const contactId = sanitizeFsId(normPhone);
  const contactName = String(conv.contactName || `Contato +${normPhone}`).trim().slice(0, 160) || 'Contato';

  // Ensure workspace doc exists cleanly (create-only, idempotent)
  await patchFirestoreDoc(
    `workspaces/${workspaceId}`,
    {
      ownerId: workspaceId,
      name: 'FMWS SALES AI Workspace',
      updatedAt: nowDate,
      createdAt: nowDate
    },
    auth.token,
    true
  );

  // Upsert normalized contact
  const contactPatch = await patchFirestoreDoc(
    `workspaces/${workspaceId}/whatsappContacts/${contactId}`,
    {
      ownerId: workspaceId,
      id: contactId,
      normalizedPhone: normPhone.padEnd(8, '0').slice(0, 32),
      name: contactName,
      ...(conv.leadId ? { leadId: String(conv.leadId).slice(0, 128) } : {}),
      ...(conv.clientId ? { clientId: String(conv.clientId).slice(0, 128) } : {}),
      ...(conv.lastInboundAt ? { lastInboundAt: String(conv.lastInboundAt).slice(0, 64) } : {}),
      updatedAt: nowDate
    },
    auth.token
  );
  if (!contactPatch.ok) {
    return {
      ok: false,
      reason: `Falha ao gravar contato no Firestore (HTTP ${contactPatch.status}): ${contactPatch.error || ''}`
    };
  }

  const safeStatus = ['ai_active', 'human_takeover', 'resolved'].includes(conv.status)
    ? conv.status
    : 'ai_active';
  const convPatch = await patchFirestoreDoc(
    `workspaces/${workspaceId}/whatsappConversations/${convId}`,
    {
      ownerId: workspaceId,
      id: convId,
      contactId,
      contactPhone: normPhone.padEnd(8, '0').slice(0, 32),
      contactName,
      status: safeStatus,
      aiPaused: Boolean(conv.aiPaused),
      assignedAgent: String(conv.assignedAgent || 'Atendente IA').slice(0, 120) || 'Atendente IA',
      lastMessage: String(conv.lastMessage || '').slice(0, 2000),
      lastMessageTimestamp: String(conv.lastMessageTimestamp || nowDate.toISOString()).slice(0, 64),
      unreadCount: Math.max(0, Math.min(10000, Math.floor(Number(conv.unreadCount) || 0))),
      ...(conv.leadId ? { leadId: String(conv.leadId).slice(0, 128) } : {}),
      ...(conv.clientId ? { clientId: String(conv.clientId).slice(0, 128) } : {}),
      ...(conv.assignedUserId ? { assignedUserId: String(conv.assignedUserId).slice(0, 128) } : {}),
      ...(conv.lastInboundAt ? { lastInboundAt: String(conv.lastInboundAt).slice(0, 64) } : {}),
      ...(conv.closedAt ? { closedAt: String(conv.closedAt).slice(0, 64) } : {}),
      ...(conv.closedBy ? { closedBy: String(conv.closedBy).slice(0, 120) } : {}),
      updatedAt: nowDate
    },
    auth.token
  );
  if (!convPatch.ok) {
    return {
      ok: false,
      reason: `Falha ao gravar conversa no Firestore (HTTP ${convPatch.status}): ${convPatch.error || ''}`
    };
  }

  if (params.message) {
    const m = params.message;
    const msgDocId = sanitizeFsId(m.metaMessageId ? `wamid_${m.metaMessageId}` : m.id);
    const msgStatus = ['sending', 'sent', 'delivered', 'read', 'failed'].includes(String(m.status))
      ? String(m.status)
      : 'sent';
    const msgPatch = await patchFirestoreDoc(
      `workspaces/${workspaceId}/whatsappConversations/${convId}/messages/${msgDocId}`,
      {
        ownerId: workspaceId,
        id: msgDocId,
        conversationId: convId,
        sender: ['contact', 'agent', 'system'].includes(m.sender) ? m.sender : 'system',
        ...(m.senderName ? { senderName: String(m.senderName).slice(0, 160) } : {}),
        text: String(m.text || '[Mensagem]').slice(0, 4096) || '[Mensagem]',
        status: msgStatus,
        ...(m.metaMessageId ? { metaMessageId: String(m.metaMessageId).slice(0, 256) } : {}),
        ...(m.errorMessage ? { errorMessage: String(m.errorMessage).slice(0, 1000) } : {}),
        aiGenerated: Boolean(m.aiGenerated),
        timestamp: String(m.timestamp || nowDate.toISOString()).slice(0, 64),
        createdAt: nowDate,
        updatedAt: nowDate
      },
      auth.token
    );
    if (!msgPatch.ok) {
      return {
        ok: false,
        reason: `Falha ao gravar mensagem no Firestore (HTTP ${msgPatch.status}): ${msgPatch.error || ''}`
      };
    }
  }

  if (params.logEntry) {
    const lg = params.logEntry;
    const logId = sanitizeFsId(lg.id);
    await patchFirestoreDoc(
      `workspaces/${workspaceId}/whatsappLogs/${logId}`,
      {
        ownerId: workspaceId,
        id: logId,
        source: ['php_bridge', 'meta_direct', 'outbound', 'ai', 'security', 'verify'].includes(lg.source)
          ? lg.source
          : 'meta_direct',
        level: ['info', 'warning', 'error'].includes(lg.level) ? lg.level : 'info',
        eventType: String(lg.eventType || 'event').slice(0, 80),
        summary: String(lg.summary || 'Evento técnico').slice(0, 600),
        ...(lg.phoneNumberId ? { phoneNumberId: String(lg.phoneNumberId).slice(0, 64) } : {}),
        ...(lg.wamid ? { wamid: String(lg.wamid).slice(0, 256) } : {}),
        ...(typeof lg.httpStatus === 'number' ? { httpStatus: Math.floor(lg.httpStatus) } : {}),
        timestamp: String(lg.timestamp || nowDate.toISOString()).slice(0, 64),
        createdAt: nowDate,
        updatedAt: nowDate
      },
      auth.token,
      true
    );
  }

  return { ok: true };
}
