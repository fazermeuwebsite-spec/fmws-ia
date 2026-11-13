import crypto from 'crypto';

const GRAPH_API_VERSION = 'v22.0';
export const OFFICIAL_PHP_WEBHOOK_URL = 'https://crm.fazermeuwebsite.com.br/api/webhooks/whatsapp.php';

export interface MetaWebhookLogEntry {
  id: string;
  timestamp: string;
  kind: 'verify' | 'messages' | 'statuses' | 'other' | 'error';
  summary: string;
}

const recentWebhookLogs: MetaWebhookLogEntry[] = [];
const usedBridgeNonces = new Map<string, number>();

export function verifyMetaHubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  const secret = (appSecret || '').trim();
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

export function verifyBridgeHmacSignature(params: {
  timestampHeader?: string;
  nonceHeader?: string;
  rawBody: Buffer | string;
  signatureHeader?: string;
  bridgeSecret: string;
}): { ok: boolean; reason?: string } {
  const secret = (params.bridgeSecret || '').trim();
  if (!secret) {
    return { ok: false, reason: 'Bridge Secret não configurado no servidor do CRM.' };
  }

  const tsRaw = String(params.timestampHeader || '').trim();
  const nonce = String(params.nonceHeader || '').trim();
  const sigRaw = String(params.signatureHeader || '').trim();

  if (!tsRaw || !nonce || !sigRaw) {
    return { ok: false, reason: 'Cabeçalhos de autenticação HMAC ausentes (X-FMWS-Timestamp, X-FMWS-Nonce, X-FMWS-Signature).' };
  }

  const ts = Number(tsRaw);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) {
    return { ok: false, reason: 'Timestamp do bridge expirado ou inválido (janela máxima ±300s).' };
  }

  if (nonce.length < 8 || nonce.length > 128) {
    return { ok: false, reason: 'Nonce do bridge inválido.' };
  }

  // Prune expired nonces (>10 min)
  const cutoff = Date.now() - 600_000;
  for (const [k, seenAt] of usedBridgeNonces.entries()) {
    if (seenAt < cutoff) usedBridgeNonces.delete(k);
  }
  if (usedBridgeNonces.has(nonce)) {
    return { ok: false, reason: 'Requisição duplicada detectada (proteção anti-replay: nonce já utilizado).' };
  }

  const providedHex = (sigRaw.startsWith('sha256=') ? sigRaw.slice(7) : sigRaw).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return { ok: false, reason: 'Formato da assinatura HMAC inválido.' };
  }

  const rawStr = Buffer.isBuffer(params.rawBody) ? params.rawBody.toString('utf-8') : String(params.rawBody || '');
  const signingInput = `${tsRaw}.${nonce}.${rawStr}`;
  const expectedHex = crypto.createHmac('sha256', secret).update(signingInput, 'utf-8').digest('hex');

  let matched = false;
  try {
    matched = crypto.timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    matched = false;
  }

  if (!matched) {
    return { ok: false, reason: 'Assinatura HMAC X-FMWS-Signature inválida.' };
  }

  usedBridgeNonces.set(nonce, Date.now());
  return { ok: true };
}

export async function probePhpWebhook(params: {
  webhookUrl: string;
  verifyToken: string;
}): Promise<{
  ok: boolean;
  httpStatus?: number;
  challengeMatched: boolean;
  bodyPreview?: string;
  error?: string;
}> {
  const url = (params.webhookUrl || OFFICIAL_PHP_WEBHOOK_URL).trim();
  const token = (params.verifyToken || '').trim();
  if (!token) {
    return { ok: false, challengeMatched: false, error: 'Verify Token não configurado no CRM.' };
  }
  const challenge = `fmws_probe_${Date.now()}`;
  const sep = url.includes('?') ? '&' : '?';
  const probeUrl = `${url}${sep}hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${encodeURIComponent(challenge)}`;

  try {
    const resp = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
    const text = (await resp.text()).trim();
    const challengeMatched = resp.status === 200 && text === challenge;
    return {
      ok: challengeMatched,
      httpStatus: resp.status,
      challengeMatched,
      bodyPreview: text.slice(0, 180),
      ...(!challengeMatched
        ? {
            error: `O webhook PHP retornou HTTP ${resp.status} (${text.slice(0, 120) || 'sem corpo'}). Esperado HTTP 200 com "${challenge}".`
          }
        : {})
    };
  } catch (err: any) {
    return {
      ok: false,
      challengeMatched: false,
      error: `Falha de rede ao consultar ${url}: ${err?.message || 'Erro desconhecido'}`
    };
  }
}

export function isWithin24hWindow(lastInboundAt?: string): boolean {
  if (!lastInboundAt) return false;
  const ts = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}

export function recordMetaWebhookLog(entry: Omit<MetaWebhookLogEntry, 'id' | 'timestamp'>): void {
  recentWebhookLogs.unshift({
    id: `wh_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (recentWebhookLogs.length > 30) {
    recentWebhookLogs.length = 30;
  }
}

export function getRecentMetaWebhookLogs(): MetaWebhookLogEntry[] {
  return [...recentWebhookLogs];
}

export function normalizePhoneForMeta(rawPhone: string): string {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Brazilian local numbers (DDD + 8 or 9 digits = 10 or 11 digits) -> prepend 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  // Canonicalize Brazilian mobile numbers missing the 9th digit (55 + DDD(2) + [6-9]xxxxxxx(8) -> 13 digits)
  if (/^55\d{2}[6-9]\d{7}$/.test(digits)) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

export function sanitizeWhatsAppIdPart(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  return cleaned || 'default';
}

export function buildWhatsAppConversationKey(params: {
  workspaceId?: string;
  phoneNumberId?: string;
  waId: string;
}): string {
  const ws = String(params.workspaceId || 'workspace').trim() || 'workspace';
  const pid = sanitizeWhatsAppIdPart(params.phoneNumberId || 'default');
  const wa = normalizePhoneForMeta(params.waId) || sanitizeWhatsAppIdPart(params.waId);
  return `${ws}:${pid}:${wa}`;
}

export function buildWhatsAppConversationId(params: {
  phoneNumberId?: string;
  waId: string;
}): string {
  const pid = sanitizeWhatsAppIdPart(params.phoneNumberId || 'default');
  const wa = normalizePhoneForMeta(params.waId) || sanitizeWhatsAppIdPart(params.waId);
  return `conv_${pid}_${wa}`.slice(0, 120);
}

function getBrazilPhoneVariants(digits: string): Set<string> {
  const variants = new Set<string>();
  if (!digits) return variants;
  variants.add(digits);

  const withoutCountry = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;

  variants.add(withoutCountry);
  variants.add(withCountry);

  // Handle BR 9th digit difference (DDD + 8 digits vs DDD + 9 + 8 digits)
  if (withoutCountry.length === 11 && withoutCountry[2] === '9') {
    const noNine = withoutCountry.slice(0, 2) + withoutCountry.slice(3);
    variants.add(noNine);
    variants.add(`55${noNine}`);
  } else if (withoutCountry.length === 10) {
    const withNine = `${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`;
    variants.add(withNine);
    variants.add(`55${withNine}`);
  }

  return variants;
}

export function phonesMatch(phoneA: string, phoneB: string): boolean {
  const a = String(phoneA || '').replace(/\D/g, '');
  const b = String(phoneB || '').replace(/\D/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const varsA = getBrazilPhoneVariants(a);
  const varsB = getBrazilPhoneVariants(b);
  for (const v of varsA) {
    if (varsB.has(v)) return true;
  }
  return false;
}

function formatMetaErrorMessage(data: any, httpStatus: number): { message: string; code?: number } {
  const errObj = data?.error || {};
  const code = typeof errObj.code === 'number' ? errObj.code : undefined;
  const rawMsg = errObj.error_data?.details || errObj.message || `Erro HTTP ${httpStatus} da Meta Cloud API`;

  if (code === 131047) {
    return {
      code,
      message:
        'Janela de 24h fechada (Meta #131047): como o cliente ainda não respondeu nas últimas 24h, a Meta exige enviar um Template aprovado (botão "Enviar Template") antes de enviar mensagens livres.'
    };
  }
  if (code === 131030) {
    return {
      code,
      message:
        'Número não autorizado no modo de teste da Meta (#131030): adicione o número do destinatário na lista "To" em Meta Developers > WhatsApp > Configuração de API ou mude o número para produção.'
    };
  }
  if (code === 131026) {
    return {
      code,
      message: `Mensagem não entregue ao destinatário (#131026): verifique se o número possui WhatsApp ativo. (${rawMsg})`
    };
  }
  if (code === 190) {
    return {
      code,
      message:
        'Access Token da Meta inválido ou expirado (#190). Gere um token permanente de Usuário do Sistema no Meta Business e atualize em Configurações.'
    };
  }
  if (code === 10 || code === 200 || code === 100) {
    return {
      code,
      message: `Permissão ou parâmetro inválido na Meta Cloud API (#${code}): ${rawMsg}`
    };
  }

  return {
    code,
    message: code ? `Meta API (#${code}): ${rawMsg}` : String(rawMsg)
  };
}

export async function sendMetaWhatsAppText(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}): Promise<{ ok: true; metaMessageId?: string } | { ok: false; error: string; code?: number; httpStatus?: number }> {
  const to = normalizePhoneForMeta(params.to);
  if (!to) {
    return { ok: false, error: 'Número de telefone do destinatário inválido para envio no WhatsApp.' };
  }
  if (!params.phoneNumberId?.trim() || !params.accessToken?.trim()) {
    return { ok: false, error: 'Phone Number ID ou Access Token da Meta não configurados.' };
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(params.phoneNumberId.trim())}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body: params.text
          }
        }),
        signal: AbortSignal.timeout(12000)
      }
    );

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const formatted = formatMetaErrorMessage(data, resp.status);
      return {
        ok: false,
        error: formatted.message,
        code: formatted.code,
        httpStatus: resp.status
      };
    }

    const metaMessageId = Array.isArray(data?.messages) ? data.messages[0]?.id : undefined;
    return { ok: true, metaMessageId };
  } catch (err: any) {
    return {
      ok: false,
      error: `Falha de conexão com a Meta Cloud API: ${err?.message || 'Erro desconhecido'}`
    };
  }
}

export async function sendMetaWhatsAppTemplate(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
}): Promise<{ ok: true; metaMessageId?: string } | { ok: false; error: string; code?: number; httpStatus?: number }> {
  const to = normalizePhoneForMeta(params.to);
  if (!to) {
    return { ok: false, error: 'Número de telefone do destinatário inválido.' };
  }

  const templatePayload: any = {
    name: params.templateName.trim(),
    language: { code: (params.languageCode || 'pt_BR').trim() }
  };

  if (Array.isArray(params.bodyParams) && params.bodyParams.length > 0) {
    templatePayload.components = [
      {
        type: 'body',
        parameters: params.bodyParams.map((val) => ({ type: 'text', text: String(val) }))
      }
    ];
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(params.phoneNumberId.trim())}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: templatePayload
        }),
        signal: AbortSignal.timeout(12000)
      }
    );

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const formatted = formatMetaErrorMessage(data, resp.status);
      return {
        ok: false,
        error: formatted.message,
        code: formatted.code,
        httpStatus: resp.status
      };
    }

    const metaMessageId = Array.isArray(data?.messages) ? data.messages[0]?.id : undefined;
    return { ok: true, metaMessageId };
  } catch (err: any) {
    return {
      ok: false,
      error: `Falha de conexão com a Meta Cloud API: ${err?.message || 'Erro desconhecido'}`
    };
  }
}

export async function fetchMetaTemplates(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: true; templates: Array<{ name: string; status: string; language: string; category: string; bodyText?: string }> } | { ok: false; error: string }> {
  if (!params.wabaId?.trim() || !params.accessToken?.trim()) {
    return { ok: false, error: 'WABA ID ou Access Token da Meta não configurados.' };
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(params.wabaId.trim())}/message_templates?fields=name,status,language,category,components&limit=50`,
      {
        headers: { Authorization: `Bearer ${params.accessToken.trim()}` },
        signal: AbortSignal.timeout(10000)
      }
    );
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: formatMetaErrorMessage(data, resp.status).message };
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    const templates = list.map((t: any) => {
      const bodyComp = Array.isArray(t.components)
        ? t.components.find((c: any) => c.type === 'BODY')
        : undefined;
      return {
        name: String(t.name || ''),
        status: String(t.status || ''),
        language: String(t.language || 'pt_BR'),
        category: String(t.category || ''),
        bodyText: bodyComp?.text ? String(bodyComp.text) : undefined
      };
    });
    return { ok: true, templates };
  } catch (err: any) {
    return { ok: false, error: `Falha ao listar templates da Meta: ${err?.message || 'Erro desconhecido'}` };
  }
}

export async function diagnoseMetaCloud(params: {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}): Promise<{
  phoneOk: boolean;
  phoneInfo?: {
    id: string;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
  };
  phoneError?: string;
  wabaSubscribed?: boolean;
  subscribedApps?: Array<{ id?: string; name?: string }>;
  wabaError?: string;
}> {
  const token = (params.accessToken || '').trim();
  const phoneId = (params.phoneNumberId || '').trim();
  const wabaId = (params.wabaId || '').trim();

  if (!token || !phoneId) {
    return {
      phoneOk: false,
      phoneError: 'Phone Number ID ou Access Token não configurados.'
    };
  }

  let phoneOk = false;
  let phoneInfo: any;
  let phoneError: string | undefined;

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      }
    );
    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok && data?.id) {
      phoneOk = true;
      phoneInfo = {
        id: String(data.id),
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
        qualityRating: data.quality_rating
      };
    } else {
      phoneError = formatMetaErrorMessage(data, resp.status).message;
    }
  } catch (err: any) {
    phoneError = err?.message || 'Falha ao consultar Phone Number ID na Meta.';
  }

  let wabaSubscribed = false;
  let subscribedApps: Array<{ id?: string; name?: string }> = [];
  let wabaError: string | undefined;

  if (wabaId) {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000)
        }
      );
      const data: any = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data?.data)) {
        subscribedApps = data.data.map((item: any) => ({
          id: item?.whatsapp_business_api_data?.id,
          name: item?.whatsapp_business_api_data?.name
        }));
        wabaSubscribed = subscribedApps.length > 0;
      } else {
        wabaError = formatMetaErrorMessage(data, resp.status).message;
      }
    } catch (err: any) {
      wabaError = err?.message || 'Falha ao consultar subscribed_apps do WABA.';
    }
  }

  return {
    phoneOk,
    phoneInfo,
    phoneError,
    wabaSubscribed,
    subscribedApps,
    wabaError
  };
}

export async function subscribeAppToWaba(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = (params.accessToken || '').trim();
  const wabaId = (params.wabaId || '').trim();
  if (!token || !wabaId) {
    return { ok: false, error: 'WABA ID ou Access Token não configurados.' };
  }
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      }
    );
    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok && data?.success) {
      return { ok: true };
    }
    return { ok: false, error: formatMetaErrorMessage(data, resp.status).message };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Erro ao inscrever app no WABA.' };
  }
}
