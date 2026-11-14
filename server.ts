import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { storage } from './src/server/storage';
import {
  GEMINI_AVAILABLE_MODELS,
  DEEPSEEK_INITIAL_MODELS,
  fetchDeepSeekModels,
  generateAtendenteResponse,
  runProspectorAudit,
  performRealWebsiteCheck,
  testAgentConnection,
  testDeepSeekIntegration,
  testGeminiIntegration
} from './src/server/aiService';
import {
  AuthenticatedRequest,
  ROLE_PERMISSIONS,
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createAuthMiddleware,
  hashPassword,
  parseCookies,
  sanitizeUser,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
  extractTokenFromRequest,
  verifySessionToken
} from './src/server/auth';
import {
  attachWhatsAppWebSocketServer,
  broadcastWhatsAppEvent,
  registerWhatsAppSseClient
} from './src/server/realtime';
import {
  OFFICIAL_PHP_WEBHOOK_URL,
  buildWhatsAppConversationId,
  buildWhatsAppConversationKey,
  diagnoseMetaCloud,
  fetchMetaTemplates,
  getRecentMetaWebhookLogs,
  isWithin24hWindow,
  normalizePhoneForMeta,
  phonesMatch,
  probePhpWebhook,
  recordMetaWebhookLog,
  sendMetaWhatsAppTemplate,
  sendMetaWhatsAppText,
  subscribeAppToWaba,
  verifyBridgeHmacSignature,
  verifyMetaHubSignature
} from './src/server/metaWhatsApp';
import { KanbanStageConfig, Lead, Project, ProspectCompany, ServiceProduct, User, UserRole, WhatsAppHandoverEntry } from './src/types';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(
  express.json({
    limit: '5mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

const { requireAuth, requireRole } = createAuthMiddleware(
  () => storage.getUsers(),
  (sid) => storage.getSessionById(sid)
);

function verifyWhatsAppRealtimeToken(token?: string): User | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const activeSession = storage.getSessionById(payload.sid);
  if (!activeSession || activeSession.userId !== payload.uid || Date.now() > activeSession.expiresAt) {
    return null;
  }
  const found = storage.getUsers().find((u) => u.id === payload.uid);
  if (!found || !found.active) return null;
  if (!['admin', 'comercial', 'suporte'].includes(found.role)) return null;
  return sanitizeUser(found);
}

function getFirebaseWebApiKey(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return String(cfg.apiKey || '').trim();
    }
  } catch {
    // ignore
  }
  return '';
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ email: string; emailVerified: boolean; name?: string; picture?: string }> {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    throw new Error('Configuração do Firebase Auth não encontrada no servidor.');
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    }
  );
  const data: any = await resp.json();
  if (!resp.ok || !Array.isArray(data?.users) || data.users.length === 0) {
    throw new Error('Token Google/Firebase inválido ou expirado.');
  }
  const fbUser = data.users[0];
  return {
    email: String(fbUser.email || '').trim().toLowerCase(),
    emailVerified: Boolean(fbUser.emailVerified),
    name: fbUser.displayName ? String(fbUser.displayName).trim() : undefined,
    picture: fbUser.photoUrl ? String(fbUser.photoUrl).trim() : undefined
  };
}

// ==========================================
// AUTHENTICATION ROUTES (PUBLIC / SESSION)
// ==========================================
app.get('/api/auth/session', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const users = storage.getUsers();
  const needsAdminSetup = !storage.hasConfiguredAdmin();

  const token = extractTokenFromRequest(req);
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.json({
      authenticated: false,
      needsAdminSetup,
      user: null,
      permissions: []
    });
  }

  const activeSession = storage.getSessionById(payload.sid);
  const found = users.find((u) => u.id === payload.uid);
  if (!activeSession || activeSession.userId !== payload.uid || !found || !found.active) {
    clearSessionCookie(req, res);
    return res.json({
      authenticated: false,
      needsAdminSetup,
      user: null,
      permissions: []
    });
  }

  return res.json({
    authenticated: true,
    needsAdminSetup: false,
    token,
    user: sanitizeUser(found),
    permissions: ROLE_PERMISSIONS[found.role] || []
  });
});

app.post('/api/auth/setup-admin', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (storage.hasConfiguredAdmin()) {
      return res.status(403).json({
        code: 'ADMIN_ALREADY_EXISTS',
        error: 'Configuração inicial bloqueada: já existe um administrador cadastrado. Faça login com seu e-mail e senha.'
      });
    }

    const { name, email, password } = req.body;
    if (!email || !String(email).includes('@') || !password || String(password).length < 6) {
      return res.status(400).json({
        error: 'Informe um e-mail válido e uma senha com pelo menos 6 caracteres.'
      });
    }

    const updatedAdmin = storage.setupInitialAdmin({
      name: (name && String(name).trim()) || 'Administrador FMWS',
      email: String(email).trim().toLowerCase(),
      passwordHash: hashPassword(String(password))
    });

    const session = storage.createSession(updatedAdmin.id, updatedAdmin.role);
    const token = signSessionToken({
      sid: session.sid,
      uid: updatedAdmin.id,
      role: updatedAdmin.role,
      exp: session.expiresAt
    });
    setSessionCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: sanitizeUser(updatedAdmin),
      permissions: ROLE_PERMISSIONS[updatedAdmin.role] || []
    });
  } catch (err: any) {
    if (err.message === 'ADMIN_ALREADY_EXISTS') {
      return res.status(403).json({
        code: 'ADMIN_ALREADY_EXISTS',
        error: 'Configuração inicial bloqueada: já existe um administrador cadastrado.'
      });
    }
    if (err.message === 'SETUP_LOCKED') {
      return res.status(409).json({
        error: 'Configuração inicial já está em andamento. Aguarde um instante.'
      });
    }
    res.status(500).json({ error: err.message || 'Falha ao configurar administrador.' });
  }
});

app.post('/api/auth/setup-admin-google', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (storage.hasConfiguredAdmin()) {
      return res.status(403).json({
        code: 'ADMIN_ALREADY_EXISTS',
        error: 'Configuração inicial bloqueada: já existe um administrador cadastrado.'
      });
    }
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Token Google não informado.' });
    }

    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.email || !verified.emailVerified) {
      return res.status(403).json({ error: 'A conta Google precisa possuir e-mail verificado.' });
    }

    const updatedAdmin = storage.setupInitialAdmin({
      name: verified.name || 'Administrador FMWS',
      email: verified.email,
      linkedGoogleEmail: verified.email,
      avatar: verified.picture
    });

    const session = storage.createSession(updatedAdmin.id, updatedAdmin.role);
    const token = signSessionToken({
      sid: session.sid,
      uid: updatedAdmin.id,
      role: updatedAdmin.role,
      exp: session.expiresAt
    });
    setSessionCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: sanitizeUser(updatedAdmin),
      permissions: ROLE_PERMISSIONS[updatedAdmin.role] || []
    });
  } catch (err: any) {
    if (err.message === 'ADMIN_ALREADY_EXISTS') {
      return res.status(403).json({
        code: 'ADMIN_ALREADY_EXISTS',
        error: 'Configuração inicial bloqueada: já existe um administrador cadastrado.'
      });
    }
    res.status(400).json({ error: err.message || 'Falha ao configurar administrador com Google.' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!storage.hasConfiguredAdmin()) {
      return res.status(409).json({
        code: 'NEEDS_ADMIN_SETUP',
        error: 'Nenhum administrador configurado ainda. Realize a configuração inicial.'
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const users = storage.getUsers();
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      const googleAdmin = users.find(
        (u) => u.role === 'admin' && u.active && !u.passwordHash && u.linkedGoogleEmail
      );
      if (normalizedEmail === 'admin@fazermeuwebsite.com.br' && googleAdmin) {
        return res.status(401).json({
          error: `Esta instância foi vinculada via Google (${googleAdmin.email}) e não possui senha local para admin@fazermeuwebsite.com.br. Entre clicando em "Entrar com Google (Firestore Sync)" e defina uma senha em Configurações > Usuários.`
        });
      }
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        error: `A conta ${user.email} foi conectada via Google (${user.linkedGoogleEmail || user.email}) e ainda não possui senha local definida. Clique em "Entrar com Google (Firestore Sync)" e defina sua senha em Configurações > Usuários.`
      });
    }

    if (!verifyPassword(String(password), user.passwordHash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
    }

    // Transparently upgrade legacy scrypt hashes to bcryptjs ($2*)
    if (!user.passwordHash.startsWith('$2')) {
      storage.saveUser({
        ...user,
        passwordHash: hashPassword(String(password))
      });
    }

    const session = storage.createSession(user.id, user.role);
    const token = signSessionToken({
      sid: session.sid,
      uid: user.id,
      role: user.role,
      exp: session.expiresAt
    });
    setSessionCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: sanitizeUser(user),
      permissions: ROLE_PERMISSIONS[user.role] || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro no login.' });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  // Invalidate ONLY the current session; NEVER delete users or reset the database
  const token = extractTokenFromRequest(req);
  const payload = verifySessionToken(token);
  if (payload?.sid) {
    storage.deleteSession(payload.sid);
  }
  clearSessionCookie(req, res);
  res.json({ success: true });
});

app.post('/api/auth/link-google', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Token Google não informado.' });
    }
    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.email || !verified.emailVerified) {
      return res.status(403).json({ error: 'A conta Google precisa possuir e-mail verificado.' });
    }
    const stored = storage.getUsers().find((u) => u.id === req.user!.id);
    if (!stored) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const saved = storage.saveUser({
      ...stored,
      linkedGoogleEmail: verified.email
    });
    res.json({ success: true, user: sanitizeUser(saved) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Falha ao vincular conta Google.' });
  }
});

app.post('/api/auth/google', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!storage.hasConfiguredAdmin()) {
      return res.status(409).json({
        code: 'NEEDS_ADMIN_SETUP',
        error: 'Nenhum administrador configurado ainda. Realize a configuração inicial.'
      });
    }
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Token Google não informado.' });
    }

    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.email || !verified.emailVerified) {
      return res.status(403).json({ error: 'Conta Google sem e-mail verificado.' });
    }

    const users = storage.getUsers();
    const user = users.find(
      (u) =>
        u.email.toLowerCase() === verified.email ||
        (u.linkedGoogleEmail && u.linkedGoogleEmail.toLowerCase() === verified.email)
    );

    if (!user) {
      return res.status(403).json({
        error: `A conta Google (${verified.email}) ainda não está vinculada a nenhum usuário do CRM. Entre com seu e-mail e senha corporativos e clique uma vez para vincular.`
      });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
    }

    const session = storage.createSession(user.id, user.role);
    const token = signSessionToken({
      sid: session.sid,
      uid: user.id,
      role: user.role,
      exp: session.expiresAt
    });
    setSessionCookie(req, res, token);

    res.json({
      success: true,
      token,
      user: sanitizeUser(user),
      permissions: ROLE_PERMISSIONS[user.role] || []
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Falha na autenticação via Google.' });
  }
});

app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }
    const stored = storage.getUsers().find((u) => u.id === req.user!.id);
    if (!stored) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (stored.passwordHash && !verifyPassword(String(currentPassword || ''), stored.passwordHash)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    storage.saveUser({
      ...stored,
      passwordHash: hashPassword(String(newPassword))
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PUBLIC WEBHOOKS (EXTERNAL PROVIDERS)
// ==========================================
app.post('/api/webhook/asaas', (req: Request, res: Response) => {
  const integrations = storage.getIntegrations();
  const webhookHeader = req.headers['asaas-access-token'];
  if (integrations.asaas.webhookSecret && webhookHeader !== integrations.asaas.webhookSecret) {
    return res.sendStatus(403);
  }
  const { event, payment } = req.body;
  if (event === 'PAYMENT_RECEIVED' && payment?.id) {
    const tx = storage.getFinancial().find((f) => f.asaasId === payment.id);
    if (tx) {
      tx.status = 'pago';
      tx.paymentDate = new Date().toISOString();
      storage.saveFinancial(tx);
    }
  }
  res.json({ received: true });
});

app.get('/api/webhook/whatsapp', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challengeRaw = req.query['hub.challenge'];
  const challenge = Array.isArray(challengeRaw)
    ? String(challengeRaw[0] ?? '')
    : String(challengeRaw ?? '');
  const integrations = storage.getIntegrations();
  const savedToken = String(integrations.metaCloud.webhookVerifyToken || '').trim();

  if (mode === 'subscribe' && savedToken && token === savedToken) {
    recordMetaWebhookLog({
      kind: 'verify',
      summary: 'Handshake GET /api/webhook/whatsapp validado (HTTP 200).'
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).set('Content-Type', 'text/plain; charset=utf-8').send(challenge);
  }
  recordMetaWebhookLog({
    kind: 'error',
    summary: `Falha na validação GET /api/webhook/whatsapp (hub.mode=${mode || 'vazio'}).`
  });
  return res.status(403).type('text/plain').send('Forbidden: verify token or hub.mode mismatch.');
});

// Sequential per-phone mutex queue & AI anti-loop rate limiter
const phoneProcessingQueues = new Map<string, Promise<void>>();
const aiReplyHistoryByConv = new Map<string, number[]>();

function enqueuePhoneTask(phoneKey: string, task: () => Promise<void>): void {
  const key = normalizePhoneForMeta(phoneKey) || phoneKey || 'global';
  const prev = phoneProcessingQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (phoneProcessingQueues.get(key) === next) {
        phoneProcessingQueues.delete(key);
      }
    });
  phoneProcessingQueues.set(key, next);
}

function canAutoReplyAi(conversationId: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const history = (aiReplyHistoryByConv.get(conversationId) || []).filter((ts) => now - ts < 5 * 60 * 1000);
  if (history.length > 0 && now - history[history.length - 1] < 2000) {
    return { allowed: false, reason: 'Intervalo mínimo anti-loop (2s) entre respostas da IA.' };
  }
  if (history.length >= 10) {
    return { allowed: false, reason: 'Limite de segurança anti-loop (10 respostas IA / 5min) atingido.' };
  }
  history.push(now);
  aiReplyHistoryByConv.set(conversationId, history);
  return { allowed: true };
}

interface ProcessedWebhookSummary {
  acceptedMessages: number;
  skippedDuplicates: number;
  updatedStatuses: number;
  skippedForeignPhone: number;
}

async function processMetaWebhookPayload(
  body: any,
  source: 'meta_direct' | 'php_bridge'
): Promise<ProcessedWebhookSummary> {
  const summary: ProcessedWebhookSummary = {
    acceptedMessages: 0,
    skippedDuplicates: 0,
    updatedStatuses: 0,
    skippedForeignPhone: 0
  };

  const entries = Array.isArray(body?.entry) ? body.entry : [];
  if (entries.length === 0) {
    recordMetaWebhookLog({
      kind: 'other',
      summary: `POST (${source}) recebido sem entries (${String(body?.object || 'desconhecido')}).`
    });
    return summary;
  }

  const integrations = storage.getIntegrations();
  const configuredPhoneId = (integrations.metaCloud.phoneNumberId || '').trim();
  const pendingAiTasks: Array<{ conversationId: string; incomingText: string; phoneKey: string }> = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const metadataPhoneId = value?.metadata?.phone_number_id
        ? String(value.metadata.phone_number_id).trim()
        : '';

      if (configuredPhoneId && metadataPhoneId && metadataPhoneId !== configuredPhoneId) {
        summary.skippedForeignPhone += 1;
        storage.recordWhatsAppLog({
          source,
          level: 'warning',
          eventType: 'foreign_phone_ignored',
          phoneNumberId: metadataPhoneId,
          summary: `Evento ignorado: phone_number_id recebido (${metadataPhoneId}) difere do configurado (${configuredPhoneId}).`
        });
        continue;
      }

      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const st of statuses) {
        const wamid = st?.id ? String(st.id).trim() : '';
        const stValue = String(st?.status || '').trim();
        const errDetail =
          Array.isArray(st?.errors) && st.errors[0]
            ? String(
                st.errors[0]?.error_data?.details ||
                  st.errors[0]?.title ||
                  st.errors[0]?.message ||
                  `Meta erro #${st.errors[0]?.code || ''}`
              )
            : undefined;
        if (wamid && ['sent', 'delivered', 'read', 'failed'].includes(stValue)) {
          const updated = storage.updateWhatsAppMessageStatus(
            wamid,
            stValue as 'sent' | 'delivered' | 'read' | 'failed',
            errDetail
          );
          if (updated) {
            summary.updatedStatuses += 1;
            broadcastWhatsAppEvent({
              type: 'whatsapp:conversation_updated',
              conversation: updated.conversation
            });
          }
          recordMetaWebhookLog({
            kind: 'statuses',
            summary: `Status "${stValue}" (${source}) para ${st?.recipient_id || wamid}${errDetail ? ` (${errDetail})` : ''}`
          });
          storage.recordWhatsAppLog({
            source,
            level: stValue === 'failed' ? 'error' : 'info',
            eventType: `status_${stValue}`,
            wamid,
            summary: `Status "${stValue}" para ${st?.recipient_id || wamid}${errDetail ? ` (${errDetail})` : ''}`,
            persist: false
          });
        }
      }

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      for (const msg of messages) {
        const incomingWamid = msg?.id ? String(msg.id).trim() : '';
        if (incomingWamid && storage.hasProcessedWamid(incomingWamid)) {
          summary.skippedDuplicates += 1;
          storage.recordWhatsAppLog({
            source,
            level: 'info',
            eventType: 'duplicate_wamid_skipped',
            wamid: incomingWamid,
            summary: `Evento duplicado ignorado por idempotência (wamid: ${incomingWamid}).`,
            persist: false
          });
          continue;
        }

        const rawFromPhone = normalizePhoneForMeta(String(msg?.from || ''));
        if (!rawFromPhone) continue;

        const contactProfile = contacts.find((c: any) => phonesMatch(String(c?.wa_id || ''), rawFromPhone));
        const profileName = contactProfile?.profile?.name ? String(contactProfile.profile.name).trim() : '';
        const cleanPhone = normalizePhoneForMeta(String(contactProfile?.wa_id || rawFromPhone)) || rawFromPhone;
        const msgType = String(msg?.type || '');
        const textBody =
          msg?.text?.body ||
          msg?.button?.text ||
          msg?.interactive?.button_reply?.title ||
          msg?.interactive?.list_reply?.title ||
          msg?.image?.caption ||
          msg?.video?.caption ||
          msg?.document?.caption ||
          (msgType === 'audio' || msgType === 'voice'
            ? '[Áudio recebido via WhatsApp]'
            : msgType === 'image'
            ? '[Imagem recebida via WhatsApp]'
            : msgType === 'document'
            ? `[Documento recebido: ${msg?.document?.filename || 'arquivo'}]`
            : msgType === 'location'
            ? `[Localização recebida: ${msg?.location?.latitude}, ${msg?.location?.longitude}]`
            : msgType === 'reaction'
            ? `[Reação ${msg?.reaction?.emoji || ''} enviada pelo contato]`
            : msgType
            ? `[Mensagem "${msgType}" recebida via WhatsApp]`
            : '');
        if (!textBody) continue;

        recordMetaWebhookLog({
          kind: 'messages',
          summary: `Mensagem (${source}) de +${cleanPhone}${profileName ? ` (${profileName})` : ''}: "${String(textBody).slice(0, 60)}"`
        });

        const incomingPid =
          String(value?.metadata?.phone_number_id || storage.getIntegrations().metaCloud.phoneNumberId || 'default').trim() ||
          'default';

        let conv = storage.findWhatsAppConversationByPhone(cleanPhone, incomingPid);
        let createdNewConv = false;

        if (!conv) {
          const matchingLead = storage
            .getLeads()
            .find((l) => phonesMatch(l.whatsapp || l.phone || '', cleanPhone));
          const matchingClient = storage
            .getClients()
            .find((c) => phonesMatch(c.whatsapp || c.phone || '', cleanPhone));
          conv = storage.saveWhatsAppConversation({
            id: buildWhatsAppConversationId({ phoneNumberId: incomingPid, waId: cleanPhone }),
            contactPhone: cleanPhone,
            waId: cleanPhone,
            phoneNumberId: incomingPid,
            contactName:
              (matchingLead ? `${matchingLead.name} (${matchingLead.company})` : '') ||
              (matchingClient
                ? `${matchingClient.contactName} (${matchingClient.tradeName || matchingClient.companyName})`
                : '') ||
              profileName ||
              `Contato +${cleanPhone}`,
            leadId: matchingLead?.id,
            clientId: matchingClient?.id,
            channel: 'meta_cloud',
            status: 'ai_active',
            aiPaused: false,
            lastMessage: String(textBody),
            lastMessageTimestamp: new Date().toISOString(),
            lastInboundAt: new Date().toISOString(),
            unreadCount: 0,
            assignedAgent: 'Atendente IA',
            tags: ['Meta Cloud Webhook'],
            handoverHistory: [],
            messages: []
          });
          createdNewConv = true;
        }

        if (createdNewConv) {
          broadcastWhatsAppEvent({ type: 'whatsapp:conversation_created', conversation: conv });
        }

        const incomingMsgResult = storage.addWhatsAppMessage(conv.id, {
          sender: 'contact',
          direction: 'inbound',
          senderName: profileName || conv.contactName,
          text: String(textBody),
          status: 'delivered',
          metaMessageId: incomingWamid || undefined,
          phoneNumberId: incomingPid,
          waId: cleanPhone
        });

        if (incomingMsgResult) {
          summary.acceptedMessages += 1;
          broadcastWhatsAppEvent({
            type: 'whatsapp:message_created',
            conversation: incomingMsgResult.conversation,
            message: incomingMsgResult.message
          });

          storage.recordWhatsAppLog({
            source,
            level: 'info',
            eventType: 'inbound_message',
            conversationId: conv.id,
            wamid: incomingWamid || undefined,
            summary: `Mensagem recebida de +${cleanPhone} salva (${incomingMsgResult.conversation.status}).`
          });

          const updatedConv = incomingMsgResult.conversation;
          if (!updatedConv.aiPaused && updatedConv.status === 'ai_active') {
            pendingAiTasks.push({
              conversationId: updatedConv.id,
              incomingText: String(textBody),
              phoneKey: updatedConv.contactPhone
            });
          }
        }
      }
    }
  }

  // Schedule Atendente IA replies asynchronously per phone number (does not delay HTTP 200 after persistence)
  for (const taskInfo of pendingAiTasks) {
    enqueuePhoneTask(taskInfo.phoneKey, async () => {
      try {
        const currentConv = storage.getWhatsAppConversations().find((c) => c.id === taskInfo.conversationId);
        if (!currentConv || currentConv.aiPaused || currentConv.status !== 'ai_active') {
          return;
        }
        if (!isWithin24hWindow(currentConv.lastInboundAt)) {
          storage.recordWhatsAppLog({
            source: 'ai',
            level: 'warning',
            eventType: 'ai_blocked_24h',
            conversationId: currentConv.id,
            summary: 'Atendente IA bloqueado: fora da janela oficial de 24h da Meta.'
          });
          return;
        }
        const rateCheck = canAutoReplyAi(currentConv.id);
        if (!rateCheck.allowed) {
          storage.recordWhatsAppLog({
            source: 'ai',
            level: 'warning',
            eventType: 'ai_rate_limited',
            conversationId: currentConv.id,
            summary: `Atendente IA bloqueado: ${rateCheck.reason}`
          });
          return;
        }

        const linkedLead = currentConv.leadId
          ? storage.getLeads().find((l) => l.id === currentConv.leadId)
          : undefined;
        const aiResponse = await generateAtendenteResponse({
          contactName: currentConv.contactName,
          incomingText: taskInfo.incomingText,
          chatHistory: currentConv.messages.slice(-14).map((m) => ({ sender: m.sender, text: m.text })),
          leadContext: linkedLead
        });

        // Re-verify state after Gemini call in case human paused or took over mid-flight
        const rechecked = storage.getWhatsAppConversations().find((c) => c.id === taskInfo.conversationId);
        if (!rechecked || rechecked.aiPaused || rechecked.status !== 'ai_active') {
          storage.recordWhatsAppLog({
            source: 'ai',
            level: 'info',
            eventType: 'ai_discarded_handover',
            conversationId: taskInfo.conversationId,
            summary: 'Resposta da IA descartada porque um humano assumiu ou pausou a conversa.'
          });
          return;
        }

        if (aiResponse.replyText) {
          let aiStatus: 'sent' | 'failed' = 'sent';
          let aiMetaMessageId: string | undefined;
          let aiErrorMsg: string | undefined;
          const latestIntegrations = storage.getIntegrations();

          if (
            latestIntegrations.metaCloud.enabled &&
            latestIntegrations.metaCloud.phoneNumberId?.trim() &&
            latestIntegrations.metaCloud.accessToken?.trim()
          ) {
            const sendRes = await sendMetaWhatsAppText({
              phoneNumberId: latestIntegrations.metaCloud.phoneNumberId,
              accessToken: latestIntegrations.metaCloud.accessToken,
              to: rechecked.contactPhone,
              text: aiResponse.replyText
            });
            if (sendRes.ok) {
              aiMetaMessageId = sendRes.metaMessageId;
            } else {
              aiStatus = 'failed';
              aiErrorMsg = sendRes.error;
            }
          }

          const aiMsgResult = storage.addWhatsAppMessage(rechecked.id, {
            sender: 'agent',
            senderName: 'Atendente IA (Fazer Meu Website)',
            text: aiResponse.replyText,
            aiGenerated: true,
            status: aiStatus,
            metaMessageId: aiMetaMessageId,
            errorMessage: aiErrorMsg
          });
          if (aiMsgResult) {
            broadcastWhatsAppEvent({
              type: 'whatsapp:message_created',
              conversation: aiMsgResult.conversation,
              message: aiMsgResult.message
            });
          }
          storage.recordWhatsAppLog({
            source: 'ai',
            level: aiStatus === 'failed' ? 'error' : 'info',
            eventType: aiStatus === 'failed' ? 'ai_send_failed' : 'ai_reply_sent',
            conversationId: rechecked.id,
            wamid: aiMetaMessageId,
            summary:
              aiStatus === 'failed'
                ? `Falha ao enviar resposta da IA pela Meta API: ${aiErrorMsg}`
                : 'Resposta automática do Atendente IA enviada com sucesso.'
          });
        }

        if (aiResponse.shouldHandover) {
          const handoverConv = storage.setWhatsAppHandover({
            conversationId: rechecked.id,
            status: 'human_takeover',
            assignedAgent: 'Humano',
            aiPaused: true,
            byUser: 'Atendente IA',
            action: 'assumed_human',
            note: 'Transferência automática solicitada pelo contato ou guardrail comercial.'
          });
          if (handoverConv) {
            broadcastWhatsAppEvent({
              type: 'whatsapp:conversation_updated',
              conversation: handoverConv
            });
          }
        }

        if (rechecked.leadId && aiResponse.suggestedLeadStatus) {
          const lead = storage.getLeads().find((l) => l.id === rechecked.leadId);
          if (lead && lead.status !== aiResponse.suggestedLeadStatus) {
            lead.status = aiResponse.suggestedLeadStatus as any;
            storage.saveLead(lead);
          }
        }
      } catch (aiErr: any) {
        storage.recordWhatsAppLog({
          source: 'ai',
          level: 'error',
          eventType: 'ai_error',
          conversationId: taskInfo.conversationId,
          summary: `Erro na automação Atendente IA: ${aiErr?.message || 'Erro desconhecido'}`
        });
      }
    });
  }

  return summary;
}

app.post('/api/webhook/whatsapp', async (req: Request, res: Response) => {
  try {
    const integrations = storage.getIntegrations();
    const appSecret = (integrations.metaCloud.appSecret || '').trim();
    if (appSecret) {
      const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBuf: Buffer | string = (req as any).rawBody || JSON.stringify(req.body || {});
      if (!verifyMetaHubSignature(rawBuf, sigHeader, appSecret)) {
        storage.recordWhatsAppLog({
          source: 'security',
          level: 'error',
          eventType: 'meta_signature_invalid',
          httpStatus: 403,
          summary: 'Assinatura X-Hub-Signature-256 inválida rejeitada em POST /api/webhook/whatsapp.'
        });
        return res.status(403).json({ error: 'Invalid X-Hub-Signature-256 signature' });
      }
    }

    const summary = await processMetaWebhookPayload(req.body, 'meta_direct');
    return res.status(200).json({ status: 'received', ...summary });
  } catch (err: any) {
    recordMetaWebhookLog({
      kind: 'error',
      summary: `Erro ao processar webhook WhatsApp: ${err?.message || 'Erro desconhecido'}`
    });
    storage.recordWhatsAppLog({
      source: 'meta_direct',
      level: 'error',
      eventType: 'webhook_process_error',
      httpStatus: 500,
      summary: `Falha ao persistir POST /api/webhook/whatsapp: ${err?.message || 'Erro desconhecido'}`
    });
    return res.status(500).json({ error: 'Failed to process WhatsApp webhook payload' });
  }
});

// Authenticated bridge route receiving forwarded events from official PHP webhook
app.post('/api/integrations/whatsapp-bridge', async (req: Request, res: Response) => {
  try {
    const integrations = storage.getIntegrations();
    const rawBuf: Buffer | string = (req as any).rawBody || JSON.stringify(req.body || {});
    const hmacCheck = verifyBridgeHmacSignature({
      timestampHeader: req.headers['x-fmws-timestamp'] as string | undefined,
      nonceHeader: req.headers['x-fmws-nonce'] as string | undefined,
      rawBody: rawBuf,
      signatureHeader: req.headers['x-fmws-signature'] as string | undefined,
      bridgeSecret: integrations.metaCloud.bridgeSecret || ''
    });

    if (!hmacCheck.ok) {
      storage.recordWhatsAppLog({
        source: 'security',
        level: 'error',
        eventType: 'bridge_hmac_rejected',
        httpStatus: 401,
        summary: `Bridge PHP rejeitado: ${hmacCheck.reason}`
      });
      return res.status(401).json({ ok: false, error: hmacCheck.reason });
    }

    const appSecret = (integrations.metaCloud.appSecret || '').trim();
    const forwardedMetaSig = (req.headers['x-meta-hub-signature-256'] ||
      req.headers['x-hub-signature-256']) as string | undefined;
    if (appSecret && forwardedMetaSig) {
      if (!verifyMetaHubSignature(rawBuf, forwardedMetaSig, appSecret)) {
        storage.recordWhatsAppLog({
          source: 'security',
          level: 'error',
          eventType: 'bridge_meta_sig_invalid',
          httpStatus: 403,
          summary: 'Assinatura Meta X-Hub-Signature-256 encaminhada pelo PHP não confere.'
        });
        return res.status(403).json({ ok: false, error: 'Forwarded Meta signature mismatch' });
      }
    }

    const summary = await processMetaWebhookPayload(req.body, 'php_bridge');
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    storage.recordWhatsAppLog({
      source: 'php_bridge',
      level: 'error',
      eventType: 'bridge_internal_error',
      httpStatus: 500,
      summary: `Erro interno ao processar evento do bridge PHP: ${err?.message || 'Erro desconhecido'}`
    });
    return res.status(500).json({ ok: false, error: err?.message || 'Internal bridge error' });
  }
});

// Real-time Server-Sent Events stream (supports cookie or ?token= for EventSource fallback)
app.get('/api/whatsapp/stream', (req: Request, res: Response) => {
  const rawToken =
    extractTokenFromRequest(req) ||
    (typeof req.query.token === 'string' ? req.query.token.trim() : '');
  const user = verifyWhatsAppRealtimeToken(rawToken);
  if (!user) {
    return res.status(401).json({
      error: 'Autenticação necessária para o stream em tempo real do WhatsApp.',
      code: 'UNAUTHENTICATED'
    });
  }
  registerWhatsAppSseClient(req, res, storage.getWhatsAppConversations());
});

// ==========================================
// ALL PROTECTED /api/* ROUTES REQUIRE AUTH
// ==========================================
app.use('/api', (req: AuthenticatedRequest, res: Response, next) => {
  // Public auth/webhook/HMAC-bridge routes handle their own auth; protect anything remaining under /api
  if (
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/webhook/') ||
    req.path === '/integrations/whatsapp-bridge'
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

// --- USER MANAGEMENT (ADMIN ONLY) ---
app.get('/api/users', requireRole('admin'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getUsers().map(sanitizeUser));
});

app.post('/api/users', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role, active } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do usuário é obrigatório.' });
    }
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório.' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' });
    }
    const validRoles: UserRole[] = ['admin', 'comercial', 'suporte', 'financeiro'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Função (role) inválida.' });
    }

    const normEmail = String(email).trim().toLowerCase();
    if (storage.getUsers().some((u) => u.email.toLowerCase() === normEmail)) {
      return res.status(409).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
    }

    const created = storage.saveUser({
      id: `usr_${Date.now()}`,
      name: String(name).trim(),
      email: normEmail,
      role,
      active: active !== false,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(String(name).trim())}&background=D4A72C&color=090B10&bold=true`,
      passwordHash: hashPassword(String(password)),
      createdAt: new Date().toISOString()
    });

    res.status(201).json(sanitizeUser(created));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = storage.getUsers().find((u) => u.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const { name, email, role, active, password } = req.body;
    if (existing.id === req.user!.id && active === false) {
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta.' });
    }

    const nextEmail = email ? String(email).trim().toLowerCase() : existing.email;
    if (email && (!nextEmail.includes('@') || nextEmail.length < 5)) {
      return res.status(400).json({ error: 'Informe um e-mail corporativo válido.' });
    }
    if (
      email &&
      storage
        .getUsers()
        .some((u) => u.id !== existing.id && u.email.toLowerCase() === nextEmail)
    ) {
      return res.status(409).json({ error: 'Já existe outro usuário cadastrado com este e-mail.' });
    }

    const updated = storage.saveUser({
      ...existing,
      name: name ? String(name).trim() : existing.name,
      email: nextEmail,
      role: role || existing.role,
      active: typeof active === 'boolean' ? active : existing.active,
      passwordHash: password && String(password).length >= 6 ? hashPassword(String(password)) : existing.passwordHash
    });

    res.json(sanitizeUser(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: 'Você não pode excluir o administrador atualmente conectado.' });
  }
  const target = storage.getUsers().find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const remainingAdmins = storage.getUsers().filter((u) => u.role === 'admin' && u.active && u.id !== req.params.id);
  if (target.role === 'admin' && remainingAdmins.length === 0) {
    return res.status(400).json({ error: 'Deve existir pelo menos um administrador ativo no sistema.' });
  }

  const success = storage.deleteUser(req.params.id);
  res.json({ success });
});

// --- DASHBOARD METRICS ---
app.get('/api/dashboard/metrics', (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(storage.getDashboardMetrics());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- KANBAN STAGES ---
app.get('/api/kanban/stages', (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    crmStages: storage.getCrmStages(),
    projectStages: storage.getProjectStages()
  });
});

app.put('/api/kanban/stages/crm', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const stages = req.body.stages as KanbanStageConfig[];
    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos uma etapa para o funil CRM.' });
    }
    const newIds = new Set(stages.map((s) => s.id));
    const leadsInRemovedStage = storage.getLeads().filter((l) => !newIds.has(l.status));
    if (leadsInRemovedStage.length > 0) {
      return res.status(400).json({
        error: `Existem ${leadsInRemovedStage.length} lead(s) na etapa que você tentou remover. Mova-os antes de excluir a etapa.`
      });
    }
    const saved = storage.saveCrmStages(stages);
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/kanban/stages/projects', requireRole('admin', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const stages = req.body.stages as KanbanStageConfig[];
    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos uma etapa para o Kanban de Projetos.' });
    }
    const newIds = new Set(stages.map((s) => s.id));
    const projsInRemoved = storage.getProjects().filter((p) => !newIds.has(p.stage));
    if (projsInRemoved.length > 0) {
      return res.status(400).json({
        error: `Existem ${projsInRemoved.length} projeto(s) na etapa que você tentou remover. Mova-os antes de excluir a etapa.`
      });
    }
    const saved = storage.saveProjectStages(stages);
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- LEADS & CRM ---
app.get('/api/leads', requireRole('admin', 'comercial', 'suporte', 'financeiro'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getLeads());
});

app.post('/api/leads', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { company, name } = req.body;
    if (!company || !String(company).trim() || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome da empresa e contato são obrigatórios.' });
    }

    const now = new Date().toISOString();
    const leadData: Lead = {
      ...req.body,
      id: req.body.id || `lead_${Date.now()}`,
      company: String(company).trim(),
      name: String(name).trim(),
      priority: req.body.priority || 'media',
      assignedTo: req.body.assignedTo || req.user!.name,
      notes: Array.isArray(req.body.notes) ? req.body.notes : [],
      history: [
        {
          id: `hist_${Date.now()}`,
          action: 'Lead cadastrado no CRM',
          toStage: req.body.status || 'novo',
          user: req.user!.name,
          date: now
        }
      ],
      createdAt: now,
      updatedAt: now
    };
    const saved = storage.saveLead(leadData);
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/leads/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = storage.getLeads().find((l) => l.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const stages = storage.getCrmStages();
    const history = Array.isArray(existing.history) ? [...existing.history] : [];

    if (req.body.status && req.body.status !== existing.status) {
      const fromLabel = stages.find((s) => s.id === existing.status)?.label || existing.status;
      const toLabel = stages.find((s) => s.id === req.body.status)?.label || req.body.status;
      history.unshift({
        id: `hist_${Date.now()}`,
        action: `Movido de "${fromLabel}" para "${toLabel}"`,
        fromStage: existing.status,
        toStage: req.body.status,
        user: req.user!.name,
        date: new Date().toISOString()
      });
    } else if (req.body.company || req.body.value !== undefined || req.body.priority) {
      history.unshift({
        id: `hist_${Date.now()}`,
        action: 'Dados do lead atualizados',
        user: req.user!.name,
        date: new Date().toISOString()
      });
    }

    const updated = storage.saveLead({
      ...existing,
      ...req.body,
      id,
      history
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/leads/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteLead(req.params.id);
  if (!success) return res.status(404).json({ error: 'Lead não encontrado.' });
  res.json({ success });
});

app.post('/api/leads/import', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const { leads } = req.body;
  if (!Array.isArray(leads)) {
    return res.status(400).json({ error: 'Formato inválido. Envie um array de leads.' });
  }
  const result = storage.importLeads(leads);
  res.json(result);
});

app.post('/api/leads/:id/approve-outreach', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const lead = storage.getLeads().find((l) => l.id === id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

  lead.campaignStatus = 'aprovado';
  lead.notes.push({
    id: `note_${Date.now()}`,
    author: req.user!.name,
    text: 'Primeiro contato comercial de prospecção aprovado formalmente para envio via WhatsApp.',
    createdAt: new Date().toISOString()
  });
  lead.history = [
    {
      id: `hist_${Date.now()}`,
      action: 'Abordagem de prospecção aprovada para WhatsApp',
      user: req.user!.name,
      date: new Date().toISOString()
    },
    ...(lead.history || [])
  ];

  const updated = storage.saveLead(lead);

  const outreachPid =
    String(storage.getIntegrations().metaCloud.phoneNumberId || 'default').trim() || 'default';
  const cleanLeadPhone = normalizePhoneForMeta(lead.whatsapp || lead.phone || '');
  let conv = cleanLeadPhone
    ? storage.findWhatsAppConversationByPhone(cleanLeadPhone, outreachPid)
    : undefined;
  if (!conv && cleanLeadPhone) {
    conv = storage.saveWhatsAppConversation({
      id: buildWhatsAppConversationId({ phoneNumberId: outreachPid, waId: cleanLeadPhone }),
      contactPhone: cleanLeadPhone,
      waId: cleanLeadPhone,
      phoneNumberId: outreachPid,
      contactName: `${lead.name} (${lead.company})`,
      leadId: lead.id,
      channel: 'meta_cloud',
      status: 'ai_active',
      lastMessage: req.body.pitchText || `Olá ${lead.name}, tudo bem? Aqui é da Fazer Meu Website.`,
      lastMessageTimestamp: new Date().toISOString(),
      unreadCount: 0,
      assignedAgent: 'Atendente IA',
      tags: ['Prospecção Aprovada', lead.segment],
      messages: [
        {
          id: `msg_${Date.now()}`,
          sender: 'agent',
          direction: 'outbound',
          senderName: `${req.user!.name} (Aprovado)`,
          text:
            req.body.pitchText ||
            `Olá ${lead.name}, tudo bem? Aqui é da Fazer Meu Website. Notamos oportunidades importantes no posicionamento online da ${lead.company}.`,
          timestamp: new Date().toISOString(),
          status: 'sent',
          phoneNumberId: outreachPid,
          waId: cleanLeadPhone,
          aiGenerated: false
        }
      ]
    });
    broadcastWhatsAppEvent({ type: 'whatsapp:conversation_created', conversation: conv });
  }

  res.json({ success: true, lead: updated, conversation: conv });
});

// --- PROSPECTING: MANUAL, CSV, DEDUPLICATION, WEBSITE AUDIT & OPTIONAL GOOGLE PLACES ---
app.get('/api/prospects', requireRole('admin', 'comercial'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getProspects());
});

app.post('/api/prospects', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { company, name, phone, whatsapp, email, segment, city, state, address, websiteUrl } = req.body;
    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
    }

    const normCompany = String(company).trim().toLowerCase();
    const cleanPhone = String(whatsapp || phone || '').replace(/\D/g, '');

    const duplicateInLeads = storage.getLeads().some(
      (l) =>
        l.company.toLowerCase().trim() === normCompany ||
        (cleanPhone && (l.whatsapp || l.phone || '').replace(/\D/g, '') === cleanPhone)
    );
    const duplicateInProspects = storage.getProspects().some(
      (p) =>
        p.company.toLowerCase().trim() === normCompany ||
        (cleanPhone && (p.whatsapp || p.phone || '').replace(/\D/g, '') === cleanPhone)
    );

    if (duplicateInLeads || duplicateInProspects) {
      return res.status(409).json({
        error: duplicateInLeads
          ? 'Empresa ou telefone já cadastrado no CRM.'
          : 'Empresa ou telefone já existe na lista de Prospecção.'
      });
    }

    const hasSite = Boolean(websiteUrl && String(websiteUrl).trim().length > 3);
    const prospect: ProspectCompany = {
      id: `prosp_${Date.now()}`,
      name: (name && String(name).trim()) || 'Contato Comercial',
      company: String(company).trim(),
      email: (email && String(email).trim()) || '',
      phone: (phone && String(phone).trim()) || '',
      whatsapp: cleanPhone,
      segment: (segment && String(segment).trim()) || 'Geral',
      city: (city && String(city).trim()) || '',
      state: (state && String(state).trim()) || '',
      address: (address && String(address).trim()) || '',
      websiteUrl: (websiteUrl && String(websiteUrl).trim()) || '',
      source: 'manual',
      technicalAudit: {
        score: 0,
        hasWebsite: hasSite,
        ssl: false,
        mobileReady: false,
        speedScore: 0,
        issues: hasSite ? ['Aguardando auditoria individual do site'] : ['Nenhum website informado'],
        recommendedService: hasSite ? 'Auditoria Técnica Pendente' : 'Criação de Website'
      },
      createdAt: new Date().toISOString()
    };

    const saved = storage.saveProspect(prospect);
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prospects/import-csv', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos uma linha válida do arquivo CSV.' });
    }

    const prepared: ProspectCompany[] = rows
      .filter((r: any) => r && r.company && String(r.company).trim())
      .map((r: any, idx: number) => {
        const site = String(r.websiteUrl || r.site || '').trim();
        const hasSite = site.length > 3;
        const phoneStr = String(r.phone || r.telefone || '').trim();
        const waStr = String(r.whatsapp || phoneStr).replace(/\D/g, '');
        return {
          id: `prosp_csv_${Date.now()}_${idx}`,
          name: String(r.name || r.contato || 'Contato Comercial').trim(),
          company: String(r.company || r.empresa).trim(),
          email: String(r.email || '').trim(),
          phone: phoneStr,
          whatsapp: waStr,
          segment: String(r.segment || r.segmento || 'Geral').trim(),
          city: String(r.city || r.cidade || '').trim(),
          state: String(r.state || r.uf || '').trim(),
          address: String(r.address || r.endereco || '').trim(),
          websiteUrl: site,
          source: 'csv',
          technicalAudit: {
            score: 0,
            hasWebsite: hasSite,
            ssl: false,
            mobileReady: false,
            speedScore: 0,
            issues: hasSite ? ['Aguardando auditoria individual do site'] : ['Nenhum website informado'],
            recommendedService: hasSite ? 'Auditoria Técnica Pendente' : 'Criação de Website'
          },
          createdAt: new Date().toISOString()
        };
      });

    const result = storage.importProspects(prepared);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prospects/:id/audit', requireRole('admin', 'comercial'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prospect = storage.getProspects().find((p) => p.id === req.params.id);
    if (!prospect) return res.status(404).json({ error: 'Empresa não encontrada na prospecção.' });

    const targetUrl = req.body.websiteUrl !== undefined ? String(req.body.websiteUrl).trim() : prospect.websiteUrl;
    const auditRes = await runProspectorAudit({
      companyName: prospect.company,
      segment: prospect.segment,
      city: prospect.city,
      state: prospect.state,
      websiteUrl: targetUrl
    });

    const updated = storage.saveProspect({
      ...prospect,
      websiteUrl: targetUrl,
      technicalAudit: auditRes.audit,
      pitchDraft: auditRes.pitchDraft || prospect.pitchDraft,
      aiInsights: auditRes.aiInsights || prospect.aiInsights
    });

    res.json({
      prospect: updated,
      geminiUsed: auditRes.geminiUsed,
      aiUsed: auditRes.aiUsed,
      providerUsed: auditRes.providerUsed,
      modelUsed: auditRes.modelUsed,
      fallbackUsed: auditRes.fallbackUsed,
      latencyMs: auditRes.latencyMs,
      totalTokens: auditRes.totalTokens,
      warning: auditRes.warning
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/prospects/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteProspect(req.params.id);
  if (!success) return res.status(404).json({ error: 'Empresa não encontrada.' });
  res.json({ success });
});

app.post('/api/prospecting/search', requireRole('admin', 'comercial'), async (req: AuthenticatedRequest, res: Response) => {
  const { state, city, segment } = req.body;
  const integrations = storage.getIntegrations();

  if (
    !integrations.googlePlaces.enabled ||
    !integrations.googlePlaces.apiKey ||
    integrations.googlePlaces.apiKey.trim() === ''
  ) {
    return res.status(400).json({
      totalFound: 0,
      engine: 'Google Places API',
      results: [],
      configured: false,
      message:
        'Google Places está desativado porque não há uma API Key configurada e autorizada em Configurações. Utilize o Cadastro Manual ou Importação CSV abaixo.'
    });
  }

  try {
    const query = `${segment || 'empresas'} em ${city || 'São Paulo'}, ${state || 'SP'}`;
    // Places API (New): https://developers.google.com/maps/documentation/places/web-service/text-search
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': integrations.googlePlaces.apiKey.trim(),
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName'
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: 20
      })
    });
    const data: any = await response.json();

    if (!response.ok || data?.error) {
      const apiStatus = data?.error?.status || `HTTP_${response.status}`;
      const apiMsg = data?.error?.message || 'Erro retornado pela Places API (New).';
      return res.status(400).json({
        totalFound: 0,
        engine: 'Google Places API (New)',
        results: [],
        configured: true,
        error: `Erro retornado pelo Google Places (${apiStatus}): ${apiMsg}`
      });
    }

    const rawPlaces = Array.isArray(data.places) ? data.places : [];
    const prepared: ProspectCompany[] = rawPlaces.map((place: any, index: number) => {
      const phone = place.nationalPhoneNumber || place.internationalPhoneNumber || '';
      const whatsappSource = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
      const websiteUrl = place.websiteUri || '';
      const companyName = place.displayName?.text || `Empresa Local ${index + 1}`;
      return {
        id: `places_${place.id || index}_${Date.now()}`,
        name: 'Contato Comercial',
        company: companyName,
        email: '',
        phone,
        whatsapp: whatsappSource.replace(/\D/g, ''),
        segment: segment || place.primaryTypeDisplayName?.text || 'Comércio Local',
        city: city || '',
        state: state || '',
        address: place.formattedAddress || '',
        websiteUrl,
        source: 'google_places',
        technicalAudit: {
          score: 0,
          hasWebsite: Boolean(websiteUrl),
          ssl: false,
          mobileReady: false,
          speedScore: 0,
          issues: websiteUrl
            ? ['Aguardando auditoria individual']
            : ['Sem website informado no Google Places'],
          recommendedService: websiteUrl ? 'Auditoria Técnica Pendente' : 'Criação de Website'
        },
        createdAt: new Date().toISOString()
      };
    });

    const importStats = storage.importProspects(prepared);
    res.json({
      totalFound: prepared.length,
      imported: importStats.imported,
      duplicates: importStats.duplicates,
      engine: 'Google Places API (New)',
      results: importStats.prospects,
      configured: true
    });
  } catch (err: any) {
    res.status(500).json({
      totalFound: 0,
      engine: 'Google Places API (New)',
      results: [],
      configured: true,
      error: `Falha na requisição ao Google Places: ${err.message}`
    });
  }
});

app.post('/api/prospecting/audit-company', requireRole('admin', 'comercial'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { companyName, segment, city, state, websiteUrl } = req.body;
    if (!companyName || !String(companyName).trim()) {
      const onlyCheck = await performRealWebsiteCheck(websiteUrl);
      return res.json({ audit: onlyCheck, geminiUsed: false });
    }
    const auditResult = await runProspectorAudit({
      companyName: String(companyName).trim(),
      segment: segment || 'Geral',
      city: city || '',
      state: state || '',
      websiteUrl
    });
    res.json(auditResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- CLIENTS ---
app.get('/api/clients', requireRole('admin', 'comercial', 'suporte', 'financeiro'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getClients());
});

app.post('/api/clients', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  if (!req.body.companyName || !String(req.body.companyName).trim()) {
    return res.status(400).json({ error: 'Razão Social do cliente é obrigatória.' });
  }
  const clientData = {
    ...req.body,
    id: req.body.id || `cli_${Date.now()}`,
    createdAt: new Date().toISOString()
  };
  const saved = storage.saveClient(clientData);
  res.status(201).json(saved);
});

app.put('/api/clients/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const existing = storage.getClients().find((c) => c.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const updated = storage.saveClient({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

app.delete('/api/clients/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteClient(req.params.id);
  if (!success) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json({ success });
});

// --- PROPOSALS ---
app.get('/api/proposals', requireRole('admin', 'comercial', 'financeiro'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getProposals());
});

app.post('/api/proposals', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const count = storage.getProposals().length + 1;
  const proposal = {
    ...req.body,
    id: req.body.id || `prop_${Date.now()}`,
    code: req.body.code || `PROP-2026-${String(count).padStart(4, '0')}`,
    createdBy: req.user!.name,
    createdAt: new Date().toISOString(),
    version: 1,
    status: req.body.status || 'aguardando_aprovacao',
    history: [
      {
        action: 'Proposta elaborada no sistema',
        date: new Date().toISOString(),
        user: req.user!.name
      }
    ]
  };
  const saved = storage.saveProposal(proposal);
  res.status(201).json(saved);
});

app.put('/api/proposals/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const existing = storage.getProposals().find((p) => p.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proposta não encontrada.' });
  const updated = storage.saveProposal({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

app.post('/api/proposals/:id/approve', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const updated = storage.approveProposal(req.params.id, req.user!.name);
  if (!updated) return res.status(404).json({ error: 'Proposta não encontrada.' });
  res.json({ success: true, proposal: updated });
});

app.delete('/api/proposals/:id', requireRole('admin', 'comercial'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteProposal(req.params.id);
  if (!success) return res.status(404).json({ error: 'Proposta não encontrada.' });
  res.json({ success });
});

// --- PROJECTS ---
app.get('/api/projects', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getProjects());
});

app.post('/api/projects', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.body.title || !String(req.body.title).trim() || !req.body.clientName || !String(req.body.clientName).trim()) {
      return res.status(400).json({ error: 'Título do projeto e nome do cliente são obrigatórios.' });
    }
    const now = new Date().toISOString();
    const project: Project = {
      ...req.body,
      id: req.body.id || `proj_${Date.now()}`,
      title: String(req.body.title).trim(),
      clientName: String(req.body.clientName).trim(),
      manager: req.body.manager || req.user!.name,
      tasks: Array.isArray(req.body.tasks) ? req.body.tasks : [],
      deliverables: Array.isArray(req.body.deliverables) ? req.body.deliverables : [],
      notes: req.body.notes || '',
      history: [
        {
          id: `hist_${Date.now()}`,
          action: 'Projeto criado no Kanban',
          toStage: req.body.stage || 'briefing',
          user: req.user!.name,
          date: now
        }
      ],
      createdAt: now
    };
    const saved = storage.saveProject(project);
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = storage.getProjects().find((p) => p.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Projeto não encontrado.' });

    const stages = storage.getProjectStages();
    const history = Array.isArray(existing.history) ? [...existing.history] : [];

    if (req.body.stage && req.body.stage !== existing.stage) {
      const fromLabel = stages.find((s) => s.id === existing.stage)?.label || existing.stage;
      const toLabel = stages.find((s) => s.id === req.body.stage)?.label || req.body.stage;
      history.unshift({
        id: `hist_${Date.now()}`,
        action: `Etapa alterada de "${fromLabel}" para "${toLabel}"`,
        fromStage: existing.stage,
        toStage: req.body.stage,
        user: req.user!.name,
        date: new Date().toISOString()
      });
    } else if (req.body.historyAction) {
      history.unshift({
        id: `hist_${Date.now()}`,
        action: String(req.body.historyAction),
        user: req.user!.name,
        date: new Date().toISOString()
      });
    } else if (req.body.title || req.body.deadline || req.body.notes !== undefined) {
      history.unshift({
        id: `hist_${Date.now()}`,
        action: 'Detalhes do projeto atualizados',
        user: req.user!.name,
        date: new Date().toISOString()
      });
    }

    const { historyAction: _ignored, ...cleanBody } = req.body;
    const updated = storage.saveProject({
      ...existing,
      ...cleanBody,
      id: req.params.id,
      history
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', requireRole('admin', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteProject(req.params.id);
  if (!success) return res.status(404).json({ error: 'Projeto não encontrado.' });
  res.json({ success });
});

// --- FINANCIAL ---
app.get('/api/financial', requireRole('admin', 'financeiro'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getFinancial());
});

app.post('/api/financial', requireRole('admin', 'financeiro'), (req: AuthenticatedRequest, res: Response) => {
  if (!req.body.description || Number(req.body.value) <= 0) {
    return res.status(400).json({ error: 'Descrição e valor positivo são obrigatórios.' });
  }
  const tx = {
    ...req.body,
    id: req.body.id || `fin_${Date.now()}`,
    createdAt: new Date().toISOString()
  };
  const saved = storage.saveFinancial(tx);
  res.status(201).json(saved);
});

app.put('/api/financial/:id', requireRole('admin', 'financeiro'), (req: AuthenticatedRequest, res: Response) => {
  const existing = storage.getFinancial().find((f) => f.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transação não encontrada.' });
  const updated = storage.saveFinancial({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

app.delete('/api/financial/:id', requireRole('admin', 'financeiro'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteFinancial(req.params.id);
  if (!success) return res.status(404).json({ error: 'Transação não encontrada.' });
  res.json({ success });
});

// --- SUPPORT TICKETS ---
app.get('/api/support', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getSupportTickets());
});

app.post('/api/support', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const count = storage.getSupportTickets().length + 101;
  const ticket = {
    ...req.body,
    id: req.body.id || `tkt_${Date.now()}`,
    code: req.body.code || `TKT-2026-${count}`,
    assignedTo: req.body.assignedTo || req.user!.name,
    createdAt: new Date().toISOString(),
    notes: req.body.notes || []
  };
  const saved = storage.saveSupportTicket(ticket);
  res.status(201).json(saved);
});

app.put('/api/support/:id', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const existing = storage.getSupportTickets().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const updated = storage.saveSupportTicket({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

// --- WHATSAPP CONVERSATIONS ---
app.get('/api/whatsapp/conversations', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getWhatsAppConversations());
});

app.post('/api/whatsapp/conversations', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const cleanPhone = normalizePhoneForMeta(String(req.body?.phone || ''));
  if (!cleanPhone) {
    return res.status(400).json({ error: 'Número de telefone/WhatsApp é obrigatório.' });
  }

  const effectivePid =
    String(req.body?.phoneNumberId || storage.getIntegrations().metaCloud.phoneNumberId || 'default').trim() ||
    'default';
  const workspaceId = String(req.body?.workspaceId || '').trim();

  const existing = storage.findWhatsAppConversationByPhone(cleanPhone, effectivePid);
  if (existing) {
    return res.json(existing);
  }

  const matchingLead = storage.getLeads().find(
    (l) =>
      (l.id && l.id === req.body?.leadId) ||
      phonesMatch(l.whatsapp || l.phone || '', cleanPhone)
  );
  const matchingClient = storage.getClients().find(
    (c) =>
      (c.id && c.id === req.body?.clientId) ||
      phonesMatch(c.whatsapp || c.phone || '', cleanPhone)
  );

  const contactName =
    String(req.body?.contactName || '').trim() ||
    (matchingLead ? `${matchingLead.name} (${matchingLead.company})` : '') ||
    (matchingClient ? `${matchingClient.contactName} (${matchingClient.tradeName || matchingClient.companyName})` : '') ||
    `Contato +${cleanPhone}`;

  const detId = buildWhatsAppConversationId({ phoneNumberId: effectivePid, waId: cleanPhone });
  const convKey = workspaceId
    ? buildWhatsAppConversationKey({ workspaceId, phoneNumberId: effectivePid, waId: cleanPhone })
    : undefined;

  const created = storage.saveWhatsAppConversation({
    id: detId,
    contactPhone: cleanPhone,
    waId: cleanPhone,
    phoneNumberId: effectivePid,
    ...(convKey ? { conversationKey: convKey } : {}),
    contactName,
    leadId: matchingLead?.id || req.body?.leadId,
    clientId: matchingClient?.id || req.body?.clientId,
    channel: 'meta_cloud',
    status: 'human_takeover',
    aiPaused: true,
    lastMessage: 'Conversa iniciada para atendimento.',
    lastMessageTimestamp: new Date().toISOString(),
    unreadCount: 0,
    assignedAgent: 'Humano',
    tags: ['Atendimento Direto'],
    messages: []
  });

  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_created', conversation: created });
  res.status(201).json(created);
});

app.post('/api/whatsapp/firestore-hydrate', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { conversations, activeConversationId, messages, handovers, logs } = req.body || {};
    let convList = storage.getWhatsAppConversations();
    if (Array.isArray(conversations) && conversations.length > 0) {
      convList = storage.mergeWhatsAppConversationsFromFirestore(conversations);
    }
    if (activeConversationId && (Array.isArray(messages) || Array.isArray(handovers))) {
      storage.mergeWhatsAppMessagesForConversation(
        String(activeConversationId),
        Array.isArray(messages) ? messages : [],
        Array.isArray(handovers) ? handovers : []
      );
    }
    if (Array.isArray(logs) && logs.length > 0) {
      storage.mergeWhatsAppLogsFromFirestore(logs);
    }
    res.json({ ok: true, count: convList.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Falha ao hidratar conversas do Firestore.' });
  }
});

app.post('/api/whatsapp/merge-duplicates', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mergedConversation, removedIds } = req.body || {};
    if (!mergedConversation || !mergedConversation.id) {
      return res.status(400).json({ error: 'Conversa unificada inválida.' });
    }
    const list = storage.applyMergedWhatsAppConversation(
      mergedConversation,
      Array.isArray(removedIds) ? removedIds.map(String) : []
    );
    broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: mergedConversation });
    res.json({ ok: true, count: list.length, conversation: mergedConversation });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Falha ao aplicar unificação local.' });
  }
});

app.get('/api/whatsapp/attendants', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  const list = storage
    .getUsers()
    .filter((u) => u.active && ['admin', 'comercial', 'suporte'].includes(u.role))
    .map((u) => ({ id: u.id, name: u.name, role: u.role }));
  res.json(list);
});

app.post('/api/whatsapp/send', requireRole('admin', 'comercial', 'suporte'), async (req: AuthenticatedRequest, res: Response) => {
  const { conversationId, text, sender, contactPhone, contactName, phoneNumberId, workspaceId } = req.body;
  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    return res.status(400).json({ error: 'Digite uma mensagem antes de enviar.' });
  }

  const metaCloud = storage.getIntegrations().metaCloud;
  const effectivePid =
    String(phoneNumberId || metaCloud.phoneNumberId || 'default').trim() || 'default';

  let conv = conversationId
    ? storage.getWhatsAppConversations().find((c) => c.id === conversationId)
    : undefined;
  if (!conv && contactPhone) {
    const cleanPhone = normalizePhoneForMeta(String(contactPhone));
    if (cleanPhone) {
      if (conversationId) {
        conv = storage.saveWhatsAppConversation(
          {
            id: String(conversationId),
            contactPhone: cleanPhone,
            waId: cleanPhone,
            phoneNumberId: effectivePid,
            ...(workspaceId
              ? {
                  conversationKey: buildWhatsAppConversationKey({
                    workspaceId: String(workspaceId),
                    phoneNumberId: effectivePid,
                    waId: cleanPhone
                  })
                }
              : {}),
            contactName: String(contactName || `Contato +${cleanPhone}`),
            channel: 'meta_cloud',
            status: 'human_takeover',
            aiPaused: true,
            lastMessage: trimmedText,
            lastMessageTimestamp: new Date().toISOString(),
            unreadCount: 0,
            assignedAgent: req.user!.name,
            assignedUserId: req.user!.id,
            tags: ['WhatsApp Cloud API', 'Firestore'],
            messages: []
          },
          { exactIdOnly: true }
        );
      } else {
        conv =
          storage.findWhatsAppConversationByPhone(cleanPhone, effectivePid) ||
          storage.saveWhatsAppConversation({
            id: buildWhatsAppConversationId({ phoneNumberId: effectivePid, waId: cleanPhone }),
            contactPhone: cleanPhone,
            waId: cleanPhone,
            phoneNumberId: effectivePid,
            contactName: String(contactName || `Contato +${cleanPhone}`),
            channel: 'meta_cloud',
            status: 'human_takeover',
            aiPaused: true,
            lastMessage: trimmedText,
            lastMessageTimestamp: new Date().toISOString(),
            unreadCount: 0,
            assignedAgent: req.user!.name,
            assignedUserId: req.user!.id,
            tags: ['WhatsApp Cloud API', 'Firestore'],
            messages: []
          });
      }
    }
  }
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  if (!metaCloud.enabled || !metaCloud.phoneNumberId?.trim() || !metaCloud.accessToken?.trim()) {
    return res.status(400).json({
      error:
        'Meta Cloud API não está configurada/ativada. Acesse Configurações > Integrações > WhatsApp Cloud API e informe Phone Number ID e Access Token.'
    });
  }

  // Reopen resolved conversation automatically when a human agent sends a message
  if (conv.status === 'resolved') {
    const reopened = storage.setWhatsAppHandover({
      conversationId: conv.id,
      status: 'human_takeover',
      assignedAgent: req.user!.name,
      assignedUserId: req.user!.id,
      aiPaused: true,
      byUser: req.user!.name,
      action: 'reopened',
      note: 'Conversa reaberta ao enviar mensagem manual.'
    });
    if (reopened) {
      conv = reopened;
      broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: reopened });
    }
  }

  const within24h = isWithin24hWindow(conv.lastInboundAt);
  const targetWaId = normalizePhoneForMeta(conv.waId || conv.contactPhone) || conv.contactPhone;
  const sendRes = await sendMetaWhatsAppText({
    phoneNumberId: metaCloud.phoneNumberId,
    accessToken: metaCloud.accessToken,
    to: targetWaId,
    text: trimmedText
  });

  if (!sendRes.ok) {
    storage.recordWhatsAppLog({
      source: 'outbound',
      level: 'error',
      eventType: 'manual_send_failed',
      conversationId: conv.id,
      phoneNumberId: metaCloud.phoneNumberId,
      summary: `Falha ao enviar para +${targetWaId}: ${sendRes.error}`
    });
    const failedResult = storage.addWhatsAppMessage(conv.id, {
      sender: sender || 'agent',
      direction: 'outbound',
      senderName: req.user!.name,
      text: trimmedText,
      aiGenerated: false,
      status: 'failed',
      phoneNumberId: metaCloud.phoneNumberId,
      waId: targetWaId,
      errorMessage: sendRes.error
    });
    if (failedResult) {
      broadcastWhatsAppEvent({
        type: 'whatsapp:message_created',
        conversation: failedResult.conversation,
        message: failedResult.message
      });
    }
    return res.status(400).json({
      error: sendRes.error,
      code: sendRes.code ? String(sendRes.code) : 'META_SEND_FAILED',
      metaErrorCode: sendRes.code,
      within24h,
      conversation: failedResult?.conversation,
      message: failedResult?.message
    });
  }

  storage.recordWhatsAppLog({
    source: 'outbound',
    level: 'info',
    eventType: 'manual_send_ok',
    conversationId: conv.id,
    phoneNumberId: metaCloud.phoneNumberId,
    wamid: sendRes.metaMessageId,
    summary: `Mensagem manual enviada por ${req.user!.name} para +${targetWaId}.`
  });

  const result = storage.addWhatsAppMessage(conv.id, {
    sender: sender || 'agent',
    direction: 'outbound',
    senderName: req.user!.name,
    text: trimmedText,
    aiGenerated: false,
    status: 'sent',
    metaMessageId: sendRes.metaMessageId,
    phoneNumberId: metaCloud.phoneNumberId,
    waId: targetWaId
  });
  if (result) {
    broadcastWhatsAppEvent({
      type: 'whatsapp:message_created',
      conversation: result.conversation,
      message: result.message
    });
  }
  res.json({ ...result, metaSent: true, metaMessageId: sendRes.metaMessageId, within24h });
});

app.get('/api/whatsapp/templates', requireRole('admin', 'comercial', 'suporte'), async (_req: AuthenticatedRequest, res: Response) => {
  const metaCloud = storage.getIntegrations().metaCloud;
  if (!metaCloud.enabled || !metaCloud.wabaId?.trim() || !metaCloud.accessToken?.trim()) {
    return res.status(400).json({
      error: 'WABA ID ou Access Token da Meta não configurados.'
    });
  }
  const result = await fetchMetaTemplates({
    wabaId: metaCloud.wabaId,
    accessToken: metaCloud.accessToken
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ templates: result.templates });
});

app.post('/api/whatsapp/send-template', requireRole('admin', 'comercial', 'suporte'), async (req: AuthenticatedRequest, res: Response) => {
  const { conversationId, templateName, languageCode, bodyParams, previewText, contactPhone, contactName, phoneNumberId } =
    req.body || {};
  const metaCloud = storage.getIntegrations().metaCloud;
  const effectivePid =
    String(phoneNumberId || metaCloud.phoneNumberId || 'default').trim() || 'default';

  let conv = conversationId
    ? storage.getWhatsAppConversations().find((c) => c.id === conversationId)
    : undefined;
  if (!conv && contactPhone) {
    const cleanPhone = normalizePhoneForMeta(String(contactPhone));
    if (cleanPhone && conversationId) {
      conv = storage.saveWhatsAppConversation(
        {
          id: String(conversationId),
          contactPhone: cleanPhone,
          waId: cleanPhone,
          phoneNumberId: effectivePid,
          contactName: String(contactName || `Contato +${cleanPhone}`),
          channel: 'meta_cloud',
          status: 'human_takeover',
          aiPaused: true,
          lastMessage: String(previewText || `[Template "${templateName || ''}"]`),
          lastMessageTimestamp: new Date().toISOString(),
          unreadCount: 0,
          assignedAgent: req.user!.name,
          assignedUserId: req.user!.id,
          tags: ['WhatsApp Cloud API', 'Firestore'],
          messages: []
        },
        { exactIdOnly: true }
      );
    }
  }
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const tplName = String(templateName || '').trim();
  if (!tplName) return res.status(400).json({ error: 'Informe o nome do Template da Meta.' });

  if (!metaCloud.enabled || !metaCloud.phoneNumberId?.trim() || !metaCloud.accessToken?.trim()) {
    return res.status(400).json({ error: 'Meta Cloud API não configurada/ativada.' });
  }

  const targetWaId = normalizePhoneForMeta(conv.waId || conv.contactPhone) || conv.contactPhone;
  const sendRes = await sendMetaWhatsAppTemplate({
    phoneNumberId: metaCloud.phoneNumberId,
    accessToken: metaCloud.accessToken,
    to: targetWaId,
    templateName: tplName,
    languageCode: String(languageCode || 'pt_BR').trim(),
    bodyParams: Array.isArray(bodyParams) ? bodyParams.map(String) : undefined
  });

  const displayBody = previewText
    ? String(previewText)
    : `[Template Meta "${tplName}" (${languageCode || 'pt_BR'})]`;

  if (!sendRes.ok) {
    const failedResult = storage.addWhatsAppMessage(conv.id, {
      sender: 'agent',
      direction: 'outbound',
      senderName: req.user!.name,
      text: displayBody,
      status: 'failed',
      phoneNumberId: metaCloud.phoneNumberId,
      waId: targetWaId,
      errorMessage: sendRes.error
    });
    if (failedResult) {
      broadcastWhatsAppEvent({
        type: 'whatsapp:message_created',
        conversation: failedResult.conversation,
        message: failedResult.message
      });
    }
    return res.status(400).json({ error: sendRes.error, code: sendRes.code ? String(sendRes.code) : 'META_TEMPLATE_FAILED' });
  }

  const result = storage.addWhatsAppMessage(conv.id, {
    sender: 'agent',
    direction: 'outbound',
    senderName: req.user!.name,
    text: displayBody,
    status: 'sent',
    metaMessageId: sendRes.metaMessageId,
    phoneNumberId: metaCloud.phoneNumberId,
    waId: targetWaId
  });
  if (result) {
    broadcastWhatsAppEvent({
      type: 'whatsapp:message_created',
      conversation: result.conversation,
      message: result.message
    });
  }
  res.json({ ...result, metaSent: true, metaMessageId: sendRes.metaMessageId });
});

app.post('/api/whatsapp/simulate-incoming', requireRole('admin', 'comercial', 'suporte'), async (req: AuthenticatedRequest, res: Response) => {
  const { conversationId, text, contactName } = req.body;
  const conv = storage.getWhatsAppConversations().find((c) => c.id === conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const contactMsgResult = storage.addWhatsAppMessage(conversationId, {
    sender: 'contact',
    senderName: contactName || conv.contactName,
    text
  });
  if (contactMsgResult) {
    broadcastWhatsAppEvent({
      type: 'whatsapp:message_created',
      conversation: contactMsgResult.conversation,
      message: contactMsgResult.message
    });
  }

  if (!conv.aiPaused && conv.status === 'ai_active') {
    try {
      const linkedLead = conv.leadId ? storage.getLeads().find((l) => l.id === conv.leadId) : undefined;
      const aiResponse = await generateAtendenteResponse({
        contactName: conv.contactName,
        incomingText: text,
        chatHistory: conv.messages.slice(-14).map((m) => ({ sender: m.sender, text: m.text })),
        leadContext: linkedLead
      });

      if (aiResponse.replyText) {
        const aiMsgResult = storage.addWhatsAppMessage(conversationId, {
          sender: 'agent',
          senderName: 'Atendente IA (Fazer Meu Website)',
          text: aiResponse.replyText,
          aiGenerated: true
        });
        if (aiMsgResult) {
          broadcastWhatsAppEvent({
            type: 'whatsapp:message_created',
            conversation: aiMsgResult.conversation,
            message: aiMsgResult.message
          });
        }
      }

      if (aiResponse.shouldHandover) {
        const handoverConv = storage.setWhatsAppHandover({
          conversationId: conv.id,
          status: 'human_takeover',
          assignedAgent: 'Humano',
          aiPaused: true,
          byUser: 'Atendente IA',
          action: 'assumed_human',
          note: 'Transferência automática solicitada durante simulação.'
        });
        if (handoverConv) {
          broadcastWhatsAppEvent({
            type: 'whatsapp:conversation_updated',
            conversation: handoverConv
          });
        }
      }

      if (conv.leadId && aiResponse.suggestedLeadStatus) {
        const lead = storage.getLeads().find((l) => l.id === conv.leadId);
        if (lead) {
          lead.status = aiResponse.suggestedLeadStatus as any;
          storage.saveLead(lead);
        }
      }
    } catch (err) {
      console.error('Error executing automated Atendente IA reply:', err);
    }
  }

  const updatedConv = storage.getWhatsAppConversations().find((c) => c.id === conversationId);
  res.json({ success: true, conversation: updatedConv });
});

app.put('/api/whatsapp/conversations/:id/read', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const updated = storage.markWhatsAppConversationRead(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Conversa não encontrada.' });
  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: updated });
  res.json(updated);
});

app.put('/api/whatsapp/conversations/:id/handover', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const conv = storage.getWhatsAppConversations().find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const { status, assignedAgent, assignedUserId, aiPaused, note } = req.body || {};
  const nextStatus: 'ai_active' | 'human_takeover' | 'resolved' =
    status && ['ai_active', 'human_takeover', 'resolved'].includes(status) ? status : conv.status;
  const nextAssignedAgent =
    typeof assignedAgent === 'string' && assignedAgent.trim()
      ? assignedAgent.trim()
      : nextStatus === 'ai_active'
      ? 'Atendente IA'
      : conv.assignedAgent || req.user!.name;

  let action: WhatsAppHandoverEntry['action'] = 'assumed_human';
  if (typeof aiPaused === 'boolean' && status === undefined) {
    action = aiPaused ? 'ai_paused' : 'ai_resumed';
  } else if (nextStatus === 'resolved') {
    action = 'resolved';
  } else if (conv.status === 'resolved') {
    action = 'reopened';
  } else if (nextStatus === 'ai_active') {
    action = 'returned_to_ai';
  } else if (assignedUserId && assignedUserId !== conv.assignedUserId) {
    action = 'transferred';
  }

  const updated = storage.setWhatsAppHandover({
    conversationId: conv.id,
    status: nextStatus,
    assignedAgent: nextAssignedAgent,
    assignedUserId: assignedUserId !== undefined ? String(assignedUserId || '') : conv.assignedUserId,
    aiPaused: typeof aiPaused === 'boolean' ? aiPaused : nextStatus === 'ai_active' ? false : conv.aiPaused,
    byUser: req.user!.name,
    action,
    note: typeof note === 'string' && note.trim() ? note.trim() : undefined
  });

  if (!updated) return res.status(404).json({ error: 'Conversa não encontrada.' });
  storage.recordWhatsAppLog({
    source: 'handover',
    level: 'info',
    eventType: `handover_${action}`,
    conversationId: conv.id,
    summary: `Handover (${action}) por ${req.user!.name}: status=${updated.status}, responsável=${updated.assignedAgent}, aiPaused=${Boolean(updated.aiPaused)}.`
  });
  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: updated });
  res.json(updated);
});

app.put('/api/whatsapp/conversations/:id/link', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const conv = storage.getWhatsAppConversations().find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const { leadId, clientId, contactName } = req.body || {};
  const nextLeadId = leadId !== undefined ? (leadId ? String(leadId) : undefined) : conv.leadId;
  const nextClientId = clientId !== undefined ? (clientId ? String(clientId) : undefined) : conv.clientId;

  const entry: WhatsAppHandoverEntry = {
    id: `ho_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    action: 'linked',
    fromStatus: conv.status,
    toStatus: conv.status,
    assignedTo: conv.assignedAgent,
    byUser: req.user!.name,
    note: [nextLeadId ? `Lead: ${nextLeadId}` : null, nextClientId ? `Cliente: ${nextClientId}` : null]
      .filter(Boolean)
      .join(' • ') || 'Vínculo atualizado',
    at: new Date().toISOString()
  };

  const updated = storage.saveWhatsAppConversation({
    ...conv,
    leadId: nextLeadId,
    clientId: nextClientId,
    contactName:
      typeof contactName === 'string' && contactName.trim() ? contactName.trim() : conv.contactName,
    handoverHistory: [...(conv.handoverHistory || []), entry].slice(-50)
  });

  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: updated });
  res.json(updated);
});

app.post('/api/whatsapp/conversations/:id/create-lead', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const conv = storage.getWhatsAppConversations().find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

  if (conv.leadId) {
    const existingLead = storage.getLeads().find((l) => l.id === conv.leadId);
    if (existingLead) {
      return res.json({ lead: existingLead, conversation: conv, alreadyLinked: true });
    }
  }

  const nowIso = new Date().toISOString();
  const cleanName = String(req.body?.name || conv.contactName || `Contato +${conv.contactPhone}`).trim();
  const cleanCompany = String(req.body?.company || cleanName).trim();

  const newLead: Lead = {
    id: `lead_${Date.now()}`,
    name: cleanName,
    company: cleanCompany,
    email: String(req.body?.email || '').trim(),
    phone: conv.contactPhone,
    whatsapp: conv.contactPhone,
    segment: String(req.body?.segment || 'Atendimento WhatsApp').trim(),
    city: String(req.body?.city || '').trim(),
    state: String(req.body?.state || '').trim(),
    technicalAudit: {
      score: 50,
      hasWebsite: false,
      ssl: false,
      mobileReady: false,
      speedScore: 0,
      issues: [],
      recommendedService: 'Site Institucional'
    },
    status: 'contato_iniciado',
    priority: 'alta',
    source: 'whatsapp',
    value: Number(req.body?.value || 0) || 0,
    tags: ['WhatsApp Oficial'],
    assignedTo: req.user!.name,
    notes: [
      {
        id: `note_${Date.now()}`,
        author: req.user!.name,
        text: `Lead criado diretamente da conversa WhatsApp (+${conv.contactPhone}).`,
        createdAt: nowIso
      }
    ],
    history: [
      {
        id: `hist_${Date.now()}`,
        action: 'Lead gerado via Atendimento WhatsApp Oficial',
        toStage: 'contato_iniciado',
        user: req.user!.name,
        date: nowIso
      }
    ],
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const savedLead = storage.saveLead(newLead);
  const entry: WhatsAppHandoverEntry = {
    id: `ho_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    action: 'linked',
    fromStatus: conv.status,
    toStatus: conv.status,
    assignedTo: conv.assignedAgent,
    byUser: req.user!.name,
    note: `Lead criado e vinculado: ${savedLead.company} (${savedLead.id})`,
    at: nowIso
  };

  const updatedConv = storage.saveWhatsAppConversation({
    ...conv,
    leadId: savedLead.id,
    contactName: conv.contactName.startsWith('Contato +')
      ? `${savedLead.name} (${savedLead.company})`
      : conv.contactName,
    handoverHistory: [...(conv.handoverHistory || []), entry].slice(-50)
  });

  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_updated', conversation: updatedConv });
  res.status(201).json({ lead: savedLead, conversation: updatedConv });
});

app.delete('/api/whatsapp/conversations/:id', requireRole('admin', 'comercial', 'suporte'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteWhatsAppConversation(req.params.id);
  if (!success) return res.status(404).json({ error: 'Conversa não encontrada.' });
  broadcastWhatsAppEvent({ type: 'whatsapp:conversation_deleted', conversationId: req.params.id });
  res.json({ success: true });
});

// --- AI AGENTS CONFIG ---
app.get('/api/agents', (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getAIAgents());
});

app.put('/api/agents/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  const agent = storage.getAIAgents().find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente não encontrado.' });

  const nextProvider =
    req.body?.provider === 'deepseek' || req.body?.provider === 'gemini'
      ? req.body.provider
      : agent.provider || 'gemini';

  const nextFallbackEnabled =
    req.body?.fallbackEnabled !== undefined
      ? Boolean(req.body.fallbackEnabled)
      : Boolean(agent.fallbackEnabled);

  const defaultSecondary = nextProvider === 'deepseek' ? 'gemini' : 'deepseek';
  const nextFallbackProvider =
    req.body?.fallbackProvider === 'deepseek' || req.body?.fallbackProvider === 'gemini'
      ? req.body.fallbackProvider
      : agent.fallbackProvider || defaultSecondary;

  const requestedStatus = req.body?.status ?? agent.status;
  const integrations = storage.getIntegrations();
  if (requestedStatus === 'ativo') {
    if (nextProvider === 'deepseek') {
      const hasDsKey = Boolean(storage.getEffectiveDeepSeekKey());
      if (!hasDsKey) {
        return res.status(400).json({
          error: 'Não é possível ativar o agente com DeepSeek sem uma DeepSeek API Key configurada no servidor.'
        });
      }
      if (!integrations.deepseek?.enabled) {
        return res.status(400).json({
          error: 'Ative a integração DeepSeek API em Configurações > DeepSeek API antes de ativar o agente.'
        });
      }
    } else {
      if (!integrations.gemini.enabled) {
        return res.status(400).json({
          error: 'Não é possível ativar o agente com Gemini sem uma GEMINI_API_KEY ativa e habilitada no servidor.'
        });
      }
    }
  }

  const sanitizedRules = Array.isArray(req.body?.rules)
    ? req.body.rules.map((r: any) => String(r || '').trim()).filter(Boolean)
    : agent.rules;

  const thresholdNum =
    req.body?.autoReplyThreshold !== undefined && !isNaN(Number(req.body.autoReplyThreshold))
      ? Math.max(0, Math.min(100, Number(req.body.autoReplyThreshold)))
      : agent.autoReplyThreshold;

  const nextModel =
    typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : agent.model;

  const nextFallbackModel =
    typeof req.body?.fallbackModel === 'string' && req.body.fallbackModel.trim()
      ? req.body.fallbackModel.trim()
      : agent.fallbackModel;

  const updated = storage.updateAIAgent({
    ...agent,
    name: typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : agent.name,
    role: typeof req.body?.role === 'string' && req.body.role.trim() ? req.body.role.trim() : agent.role,
    provider: nextProvider,
    model: nextModel,
    fallbackEnabled: nextFallbackEnabled,
    fallbackProvider: nextFallbackProvider === nextProvider ? defaultSecondary : nextFallbackProvider,
    fallbackModel: nextFallbackModel,
    status: requestedStatus,
    personality:
      typeof req.body?.personality === 'string' ? req.body.personality.trim() : agent.personality,
    instructions:
      typeof req.body?.instructions === 'string' ? req.body.instructions : agent.instructions,
    rules: sanitizedRules,
    requiresApprovalForOutreach:
      req.body?.requiresApprovalForOutreach !== undefined
        ? Boolean(req.body.requiresApprovalForOutreach)
        : agent.requiresApprovalForOutreach,
    autoReplyThreshold: thresholdNum,
    id: agent.id
  });
  res.json(updated);
});

app.post('/api/agents/:id/test', requireRole('admin', 'comercial'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;
    if (id !== 'atendente' && id !== 'prospector') {
      return res.status(404).json({ error: 'Agente não encontrado.' });
    }
    const result = await testAgentConnection(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Falha ao testar conexão do agente.' });
  }
});

app.post('/api/agents/atendente/simulate', requireRole('admin', 'comercial', 'suporte'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'Digite uma mensagem de cliente para testar o Atendente IA.' });
    }
    const contactName = String(req.body?.contactName || 'Cliente Teste').trim();
    const chatHistory = Array.isArray(req.body?.chatHistory) ? req.body.chatHistory : [];

    const aiRes = await generateAtendenteResponse({
      contactName,
      incomingText: message,
      chatHistory
    });

    const agent = storage.getAIAgents().find((a) => a.id === 'atendente');
    res.json({
      ...aiRes,
      agent,
      integrations: storage.getSanitizedIntegrations()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao simular atendimento com IA.' });
  }
});

app.post('/api/agents/prospector/test-audit', requireRole('admin', 'comercial'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyName = String(req.body?.companyName || '').trim();
    if (!companyName) {
      return res.status(400).json({ error: 'Informe o nome da empresa para auditar.' });
    }

    const result = await runProspectorAudit({
      companyName,
      segment: String(req.body?.segment || 'Serviços Locais').trim(),
      city: String(req.body?.city || 'São Paulo').trim(),
      state: String(req.body?.state || 'SP').trim(),
      websiteUrl: typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : undefined
    });

    const agent = storage.getAIAgents().find((a) => a.id === 'prospector');
    res.json({
      ...result,
      agent,
      integrations: storage.getSanitizedIntegrations()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao executar auditoria do Prospector IA.' });
  }
});

// --- SERVICES & SANITIZED INTEGRATIONS ---
app.get('/api/services', (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getServices());
});

app.post('/api/services', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  const { name, basePrice, description, category, isRecurring, billingCycle, features } = req.body;
  if (!name || !String(name).trim() || isNaN(Number(basePrice)) || Number(basePrice) < 0) {
    return res.status(400).json({ error: 'Nome do serviço e preço válido são obrigatórios.' });
  }
  const srv: ServiceProduct = {
    id: req.body.id || `srv_custom_${Date.now()}`,
    name: String(name).trim(),
    category: category || (isRecurring ? 'recorrente' : 'desenvolvimento'),
    description: (description && String(description).trim()) || '',
    basePrice: Number(basePrice),
    isRecurring: Boolean(isRecurring),
    billingCycle: billingCycle || (isRecurring ? 'mensal' : 'unico'),
    features: Array.isArray(features) ? features : []
  };
  const saved = storage.saveService(srv);
  res.status(201).json(saved);
});

app.put('/api/services/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  const existing = storage.getServices().find((s) => s.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Serviço não encontrado.' });
  const updated = storage.saveService({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

app.delete('/api/services/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  const success = storage.deleteService(req.params.id);
  if (!success) return res.status(404).json({ error: 'Serviço não encontrado.' });
  res.json({ success });
});

// NEVER return integration tokens or API keys to frontend
app.get('/api/integrations', (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getSanitizedIntegrations());
});

app.put('/api/integrations', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = storage.updateIntegrations(req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/integrations/test-google-places', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const draftKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const existingKey = storage.getIntegrations().googlePlaces?.apiKey?.trim() || '';
    const keyToTest = draftKey || existingKey;

    if (!keyToTest) {
      return res.status(400).json({
        valid: false,
        error: 'Informe a API Key do Google Places antes de testar.'
      });
    }

    // Places API (New) Text Search endpoint
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': keyToTest,
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
      },
      body: JSON.stringify({
        textQuery: 'restaurante São Paulo',
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: 1
      })
    });
    const data: any = await response.json();

    if (response.ok && !data?.error) {
      const updated = storage.updateIntegrations({
        googlePlaces: {
          enabled: true,
          apiKey: keyToTest,
          status: 'conectado'
        }
      });
      return res.json({
        valid: true,
        status: 'conectado',
        message: 'Google Places API (New) validada e conectada com sucesso!',
        integrations: updated
      });
    }

    const updatedErr = storage.updateIntegrations({
      googlePlaces: {
        enabled: false,
        apiKey: keyToTest,
        status: 'erro'
      }
    });
    const errStatus = data?.error?.status || `HTTP_${response.status}`;
    const errMsg =
      data?.error?.message ||
      'Chave inválida ou "Places API (New)" não habilitada no projeto Google Cloud.';
    return res.status(400).json({
      valid: false,
      status: 'erro',
      error: `Google Places API (New) retornou "${errStatus}": ${errMsg}`,
      integrations: updatedErr
    });
  } catch (err: any) {
    res.status(500).json({
      valid: false,
      error: `Falha ao testar Google Places: ${err.message}`
    });
  }
});

app.post('/api/integrations/test-gemini', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
    const result = await testGeminiIntegration(requestedModel);
    if (result.valid) {
      return res.json(result);
    }
    return res.status(400).json(result);
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      error: `Falha ao testar API Gemini: ${err.message}`
    });
  }
});

app.post('/api/integrations/test-deepseek', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await testDeepSeekIntegration({
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
      baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      timeoutMs: req.body?.timeoutMs !== undefined ? Number(req.body.timeoutMs) : undefined,
      maxTokens: req.body?.maxTokens !== undefined ? Number(req.body.maxTokens) : undefined,
      quotaLimit: req.body?.quotaLimit !== undefined ? Number(req.body.quotaLimit) : undefined,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : undefined,
      saveCredentials: req.body?.saveCredentials !== undefined ? Boolean(req.body.saveCredentials) : undefined
    });
    if (result.valid) {
      return res.json(result);
    }
    return res.status(400).json(result);
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      error: `Falha ao testar API DeepSeek: ${err.message}`
    });
  }
});

app.get('/api/integrations/deepseek/models', requireRole('admin', 'comercial', 'suporte'), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const hasKey = Boolean(storage.getEffectiveDeepSeekKey());
    if (!hasKey) {
      const curModels = storage.getIntegrations().deepseek?.availableModels || DEEPSEEK_INITIAL_MODELS;
      return res.json({
        ok: false,
        source: 'fallback',
        models: curModels,
        liveModels: [],
        integrations: storage.getSanitizedIntegrations()
      });
    }
    const result = await fetchDeepSeekModels();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      source: 'fallback',
      models: DEEPSEEK_INITIAL_MODELS,
      error: err.message
    });
  }
});

app.post('/api/integrations/deepseek/models', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await fetchDeepSeekModels({
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
      baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : undefined
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      source: 'fallback',
      models: DEEPSEEK_INITIAL_MODELS,
      error: err.message
    });
  }
});

app.get('/api/integrations/gemini/models', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  const curModels = storage.getIntegrations().gemini?.availableModels;
  return res.json({
    ok: true,
    models: Array.isArray(curModels) && curModels.length > 0 ? curModels : GEMINI_AVAILABLE_MODELS
  });
});

app.post('/api/integrations/test-meta-connection', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existingMeta = storage.getIntegrations().metaCloud;
    const draftEnabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : existingMeta.enabled;
    const draftPhoneId = typeof req.body?.phoneNumberId === 'string' ? req.body.phoneNumberId.trim() : existingMeta.phoneNumberId;
    const draftWabaId = typeof req.body?.wabaId === 'string' ? req.body.wabaId.trim() : existingMeta.wabaId;
    const draftToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    const draftVerify = typeof req.body?.verifyToken === 'string' ? req.body.verifyToken.trim() : '';
    const draftAppSecret = typeof req.body?.appSecret === 'string' ? req.body.appSecret.trim() : '';

    if (
      req.body?.phoneNumberId !== undefined ||
      req.body?.wabaId !== undefined ||
      req.body?.enabled !== undefined ||
      draftToken ||
      draftVerify ||
      draftAppSecret
    ) {
      storage.updateIntegrations({
        metaCloud: {
          enabled: draftEnabled,
          phoneNumberId: draftPhoneId,
          wabaId: draftWabaId,
          status: existingMeta.status,
          ...(draftToken ? { accessToken: draftToken } : {}),
          ...(draftVerify ? { webhookVerifyToken: draftVerify } : {}),
          ...(draftAppSecret ? { appSecret: draftAppSecret } : {})
        }
      });
    }

    const mc = storage.getIntegrations().metaCloud;
    const diag = await diagnoseMetaCloud({
      phoneNumberId: mc.phoneNumberId,
      wabaId: mc.wabaId,
      accessToken: mc.accessToken || ''
    });

    const updated = storage.setMetaConnectionVerification({
      ok: diag.phoneOk,
      displayPhoneNumber: diag.phoneInfo?.displayPhoneNumber,
      verifiedName: diag.phoneInfo?.verifiedName
    });

    storage.recordWhatsAppLog({
      source: 'verify',
      level: diag.phoneOk ? 'info' : 'error',
      eventType: 'meta_connection_test',
      phoneNumberId: mc.phoneNumberId || undefined,
      summary: diag.phoneOk
        ? `Conexão Meta Graph API validada: ${diag.phoneInfo?.displayPhoneNumber || mc.phoneNumberId} (${diag.phoneInfo?.verifiedName || 'Verificado'}).`
        : `Falha no teste Meta Graph API: ${diag.phoneError || 'Credenciais inválidas'}`
    });

    return res.status(diag.phoneOk ? 200 : 400).json({
      valid: diag.phoneOk,
      status: updated.metaCloud.status,
      ...diag,
      integrations: updated,
      message: diag.phoneOk
        ? `Conexão validada na Meta Graph API: ${diag.phoneInfo?.displayPhoneNumber} (${diag.phoneInfo?.verifiedName || 'Número verificado'}).`
        : undefined,
      error: !diag.phoneOk ? diag.phoneError : undefined
    });
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      error: `Falha ao testar conexão Meta Cloud API: ${err?.message || 'Erro desconhecido'}`
    });
  }
});

app.post('/api/integrations/verify-php-webhook', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const draftVerify = typeof req.body?.verifyToken === 'string' ? req.body.verifyToken.trim() : '';
    if (draftVerify) {
      const existingMeta = storage.getIntegrations().metaCloud;
      storage.updateIntegrations({
        metaCloud: {
          ...existingMeta,
          webhookVerifyToken: draftVerify
        }
      });
    }

    const mc = storage.getIntegrations().metaCloud;
    const probe = await probePhpWebhook({
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      verifyToken: mc.webhookVerifyToken || ''
    });

    const updated = storage.setPhpWebhookVerified(probe.ok);
    storage.recordWhatsAppLog({
      source: 'verify',
      level: probe.ok ? 'info' : 'error',
      eventType: 'php_webhook_verify',
      httpStatus: probe.httpStatus,
      summary: probe.ok
        ? `Webhook PHP oficial validado (HTTP ${probe.httpStatus}, challenge confirmado).`
        : `Falha ao verificar webhook PHP oficial: ${probe.error}`
    });

    return res.status(probe.ok ? 200 : 400).json({
      valid: probe.ok,
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      ...probe,
      integrations: updated,
      message: probe.ok
        ? `Webhook PHP oficial respondendo HTTP 200 com challenge validado (${OFFICIAL_PHP_WEBHOOK_URL}).`
        : undefined
    });
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      error: `Erro ao verificar webhook PHP: ${err?.message || 'Erro desconhecido'}`
    });
  }
});

app.post('/api/integrations/generate-bridge-secret', requireRole('admin'), (_req: AuthenticatedRequest, res: Response) => {
  const generated = storage.generateBridgeSecret();
  storage.recordWhatsAppLog({
    source: 'security',
    level: 'info',
    eventType: 'bridge_secret_generated',
    summary: 'Novo Bridge Secret HMAC-SHA256 gerado no backend (exibido uma única vez para copiar para o whatsapp.php).'
  });
  res.json(generated);
});

app.get('/api/integrations/whatsapp-logs', requireRole('admin', 'comercial', 'suporte'), (_req: AuthenticatedRequest, res: Response) => {
  res.json({ logs: storage.getWhatsAppLogs() });
});

app.post('/api/integrations/test-meta-webhook', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const draftVerifyToken = typeof req.body?.verifyToken === 'string' ? req.body.verifyToken.trim() : '';
    const targetUrl = typeof req.body?.webhookUrl === 'string' && req.body.webhookUrl.trim()
      ? req.body.webhookUrl.trim()
      : OFFICIAL_PHP_WEBHOOK_URL;

    let currentIntegrations = storage.getSanitizedIntegrations();
    if (draftVerifyToken || req.body?.phoneNumberId !== undefined || req.body?.wabaId !== undefined) {
      const existingMeta = storage.getIntegrations().metaCloud;
      currentIntegrations = storage.updateIntegrations({
        metaCloud: {
          enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : existingMeta.enabled,
          phoneNumberId:
            typeof req.body?.phoneNumberId === 'string'
              ? req.body.phoneNumberId.trim()
              : existingMeta.phoneNumberId,
          wabaId:
            typeof req.body?.wabaId === 'string'
              ? req.body.wabaId.trim()
              : existingMeta.wabaId,
          status: existingMeta.status,
          ...(draftVerifyToken ? { webhookVerifyToken: draftVerifyToken } : {})
        }
      });
    }

    const savedVerifyToken = (storage.getIntegrations().metaCloud.webhookVerifyToken || '').trim();
    if (!savedVerifyToken) {
      return res.status(400).json({
        valid: false,
        localOk: false,
        externalOk: false,
        error: 'Informe e salve o Verify Token antes de testar a validação do Webhook.',
        integrations: currentIntegrations
      });
    }

    const probe = await probePhpWebhook({
      webhookUrl: targetUrl,
      verifyToken: savedVerifyToken
    });
    const updated = storage.setPhpWebhookVerified(probe.ok);

    return res.status(probe.ok ? 200 : 400).json({
      valid: probe.ok,
      localOk: true,
      externalOk: probe.ok,
      statusCode: probe.httpStatus,
      message: probe.ok
        ? `Webhook validado externamente com HTTP 200 (${targetUrl}).`
        : undefined,
      error: !probe.ok ? probe.error : undefined,
      integrations: updated
    });
  } catch (err: any) {
    return res.status(500).json({
      valid: false,
      error: `Falha ao testar Webhook Meta: ${err.message}`
    });
  }
});

app.get('/api/integrations/meta-diagnostics', requireRole('admin', 'comercial', 'suporte'), async (_req: AuthenticatedRequest, res: Response) => {
  const mc = storage.getIntegrations().metaCloud;
  const diag = await diagnoseMetaCloud({
    phoneNumberId: mc.phoneNumberId,
    wabaId: mc.wabaId,
    accessToken: mc.accessToken || ''
  });
  res.json({
    ...diag,
    enabled: mc.enabled,
    hasVerifyToken: Boolean(mc.webhookVerifyToken && mc.webhookVerifyToken.trim()),
    webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
    appUrl: process.env.APP_URL || '',
    recentWebhookLogs: getRecentMetaWebhookLogs(),
    whatsappLogs: storage.getWhatsAppLogs()
  });
});

app.post('/api/integrations/subscribe-waba', requireRole('admin'), async (_req: AuthenticatedRequest, res: Response) => {
  const mc = storage.getIntegrations().metaCloud;
  const result = await subscribeAppToWaba({
    wabaId: mc.wabaId,
    accessToken: mc.accessToken || ''
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'Falha ao inscrever app no WABA.' });
  }
  storage.recordWhatsAppLog({
    source: 'verify',
    level: 'info',
    eventType: 'waba_subscribed',
    summary: `App inscrito no WABA ${mc.wabaId} com sucesso.`
  });
  res.json({ success: true });
});

// --- FIRESTORE CLOUD SYNC SNAPSHOT (ADMIN ONLY, NO SECRETS/HASHES EXPOSED) ---
app.get('/api/cloud/export', requireRole('admin'), (_req: AuthenticatedRequest, res: Response) => {
  res.json(storage.getCloudSyncExport());
});

app.post('/api/cloud/restore', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { buckets, users, onlyFillMissing } = req.body || {};
    if (!buckets || typeof buckets !== 'object') {
      return res.status(400).json({ error: 'Snapshot de coleções inválido para restauração.' });
    }
    storage.restoreCloudSyncBuckets(buckets, users, { onlyFillMissing: Boolean(onlyFillMissing) });
    res.json({ success: true, restoredAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Falha ao restaurar dados.' });
  }
});

// --- VITE MIDDLEWARE / SPA SERVING ---
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  attachWhatsAppWebSocketServer({
    httpServer,
    authenticateUpgrade: (req, url) => {
      const cookies = parseCookies(req.headers.cookie);
      const token = url.searchParams.get('token') || cookies[SESSION_COOKIE_NAME];
      return Boolean(verifyWhatsAppRealtimeToken(token || undefined));
    },
    getInitialConversations: () => storage.getWhatsAppConversations()
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port: PORT,
        allowedHosts: true,
        ws: { server: httpServer }
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[FMWS SALES AI] Servidor rodando na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
});
