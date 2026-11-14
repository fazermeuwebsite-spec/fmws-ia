import { GoogleGenAI } from '@google/genai';
import { storage } from './storage';
import { AIProvider, Lead, TechnicalAudit } from '../types';

export const GEMINI_AVAILABLE_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash'
];

export const DEEPSEEK_INITIAL_MODELS = [
  'deepseek-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner'
];

let genAI: GoogleGenAI | null = null;

export function getAIClient(): GoogleGenAI | null {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 5) {
      try {
        genAI = new GoogleGenAI({
          apiKey: apiKey.trim(),
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build'
            }
          }
        });
      } catch (err) {
        console.warn('Could not initialize GoogleGenAI client:', err);
      }
    }
  }
  return genAI;
}

function sanitizeHttpMessage(raw: unknown): string {
  const str = String(raw || 'Erro desconhecido').trim();
  return str
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
    .slice(0, 400);
}

function normalizeBaseUrl(raw?: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return (trimmed || 'https://api.deepseek.com').replace(/\/+$/, '');
}

function extractJsonObject(rawText: string): any {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // continue
      }
    }
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function classifyDeepSeekHttpError(
  httpStatus: number,
  rawErrMsg: string
): {
  status: 'erro' | 'sem_saldo' | 'limite_atingido';
  errorCode: string;
  friendlyMessage: string;
  transient: boolean;
} {
  const cleanMsg = sanitizeHttpMessage(rawErrMsg);
  if (httpStatus === 401) {
    return {
      status: 'erro',
      errorCode: 'HTTP_401',
      friendlyMessage: `DeepSeek API Key inválida ou expirada (HTTP 401): ${cleanMsg}`,
      transient: false
    };
  }
  if (httpStatus === 402) {
    return {
      status: 'sem_saldo',
      errorCode: 'HTTP_402',
      friendlyMessage: `Sem saldo na conta DeepSeek (HTTP 402). Adicione créditos no painel da DeepSeek para continuar usando.`,
      transient: true
    };
  }
  if (httpStatus === 403) {
    return {
      status: 'erro',
      errorCode: 'HTTP_403',
      friendlyMessage: `Acesso negado pela API DeepSeek (HTTP 403): ${cleanMsg}`,
      transient: false
    };
  }
  if (httpStatus === 429) {
    return {
      status: 'limite_atingido',
      errorCode: 'HTTP_429',
      friendlyMessage: `Limite de requisições (rate limit) atingido na API DeepSeek (HTTP 429): ${cleanMsg}`,
      transient: true
    };
  }
  if (httpStatus >= 500) {
    return {
      status: 'erro',
      errorCode: `HTTP_${httpStatus}`,
      friendlyMessage: `Serviço DeepSeek temporariamente indisponível (HTTP ${httpStatus}): ${cleanMsg}`,
      transient: true
    };
  }
  return {
    status: 'erro',
    errorCode: `HTTP_${httpStatus}`,
    friendlyMessage: `Falha na API DeepSeek (HTTP ${httpStatus}): ${cleanMsg}`,
    transient: httpStatus === 408
  };
}

/**
 * Fetches available models from GET {baseUrl}/models with Bearer authentication.
 */
export async function fetchDeepSeekModels(options?: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<{
  ok: boolean;
  source: 'live_api' | 'fallback';
  models: string[];
  liveModels: string[];
  error?: string;
  httpStatus?: number;
  integrations: ReturnType<typeof storage.getSanitizedIntegrations>;
}> {
  const integrations = storage.getIntegrations();
  const baseUrl = normalizeBaseUrl(options?.baseUrl || integrations.deepseek?.baseUrl);
  const apiKey = options?.apiKey?.trim() || storage.getEffectiveDeepSeekKey();

  if (!apiKey) {
    return {
      ok: false,
      source: 'fallback',
      models: integrations.deepseek?.availableModels || DEEPSEEK_INITIAL_MODELS,
      liveModels: [],
      error: 'Informe e salve uma DeepSeek API Key para consultar GET /models dinamicamente.',
      integrations: storage.getSanitizedIntegrations()
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    clearTimeout(timeout);

    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const rawErr = data?.error?.message || data?.message || resp.statusText || `HTTP ${resp.status}`;
      const classified = classifyDeepSeekHttpError(resp.status, rawErr);
      return {
        ok: false,
        source: 'fallback',
        models: integrations.deepseek?.availableModels || DEEPSEEK_INITIAL_MODELS,
        liveModels: [],
        httpStatus: resp.status,
        error: classified.friendlyMessage,
        integrations: storage.getSanitizedIntegrations()
      };
    }

    const rawIds: string[] = Array.isArray(data?.data)
      ? data.data.map((m: any) => String(m?.id || '').trim()).filter(Boolean)
      : [];

    const merged: string[] = [];
    const seen = new Set<string>();
    for (const id of rawIds) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
    for (const preset of DEEPSEEK_INITIAL_MODELS) {
      if (!seen.has(preset)) {
        seen.add(preset);
        merged.push(preset);
      }
    }

    const updatedIntegrations = storage.updateIntegrations({
      deepseek: {
        ...integrations.deepseek,
        baseUrl,
        availableModels: merged,
        modelsUpdatedAt: new Date().toISOString()
      }
    });

    return {
      ok: true,
      source: 'live_api',
      models: merged,
      liveModels: rawIds,
      integrations: updatedIntegrations
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const msg =
      err?.name === 'AbortError'
        ? 'Timeout ao consultar GET /models na API DeepSeek.'
        : sanitizeHttpMessage(err?.message);
    return {
      ok: false,
      source: 'fallback',
      models: integrations.deepseek?.availableModels || DEEPSEEK_INITIAL_MODELS,
      liveModels: [],
      error: `Não foi possível listar modelos da DeepSeek: ${msg}`,
      integrations: storage.getSanitizedIntegrations()
    };
  }
}

export async function callDeepSeekChat(params: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  timeoutMs?: number;
  expectJson?: boolean;
}): Promise<{
  ok: boolean;
  text: string;
  reasoningContent?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  httpStatus?: number;
  errorCode?: string;
  errorStatus?: 'erro' | 'sem_saldo' | 'limite_atingido';
  errorMessage?: string;
  transient: boolean;
}> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const model = params.model.trim() || 'deepseek-flash';
  const maxTokens = Math.max(16, Math.min(8192, Math.floor(params.maxTokens || 1200)));
  const timeoutMs = Math.max(3000, Math.min(120000, Math.floor(params.timeoutMs || 25000)));
  const isReasonerModel = /reasoner|r1/i.test(model);

  const runFetch = async (useJsonFormat: boolean, includeTemperature: boolean) => {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const bodyPayload: Record<string, any> = {
        model,
        messages: params.messages,
        max_tokens: maxTokens,
        stream: false
      };
      if (includeTemperature && !isReasonerModel) {
        bodyPayload.temperature = 0.35;
      }
      if (useJsonFormat && !isReasonerModel) {
        bodyPayload.response_format = { type: 'json_object' };
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyPayload)
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      const data: any = await resp.json().catch(() => ({}));
      return { resp, data, latencyMs };
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      throw Object.assign(new Error(err?.message || 'Erro de rede'), {
        name: err?.name || 'Error',
        latencyMs
      });
    }
  };

  try {
    let attempt = await runFetch(Boolean(params.expectJson), true);

    // Some DeepSeek reasoning/preview models reject response_format or temperature with HTTP 400.
    // Retry once without those optional params before failing.
    if (
      !attempt.resp.ok &&
      attempt.resp.status === 400 &&
      (params.expectJson || !isReasonerModel)
    ) {
      const errText = String(attempt.data?.error?.message || attempt.data?.message || '').toLowerCase();
      if (
        errText.includes('response_format') ||
        errText.includes('temperature') ||
        errText.includes('json_object') ||
        errText.includes('not support')
      ) {
        attempt = await runFetch(false, false);
      }
    }

    const { resp, data, latencyMs } = attempt;
    if (!resp.ok) {
      const rawErr = data?.error?.message || data?.message || resp.statusText || `HTTP ${resp.status}`;
      const classified = classifyDeepSeekHttpError(resp.status, rawErr);
      return {
        ok: false,
        text: '',
        latencyMs,
        httpStatus: resp.status,
        errorCode: classified.errorCode,
        errorStatus: classified.status,
        errorMessage: classified.friendlyMessage,
        transient: classified.transient
      };
    }

    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const content = String(choice?.message?.content ?? '').trim();
    const reasoningContent =
      typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()
        ? choice.message.reasoning_content.trim()
        : undefined;

    const usage = data?.usage || {};
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
    const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
    const totalTokens =
      typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens || 0) + (completionTokens || 0)
        : undefined;

    return {
      ok: true,
      text: content,
      reasoningContent,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      httpStatus: resp.status,
      transient: false
    };
  } catch (err: any) {
    const latencyMs = typeof err?.latencyMs === 'number' ? err.latencyMs : 0;
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      text: '',
      latencyMs,
      errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorStatus: 'erro',
      errorMessage: isAbort
        ? `Timeout acima de ${Math.round(timeoutMs / 1000)}s ao conectar na API DeepSeek.`
        : `Falha de rede ao chamar DeepSeek API: ${sanitizeHttpMessage(err?.message)}`,
      transient: true
    };
  }
}

export async function testDeepSeekIntegration(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  quotaLimit?: number;
  enabled?: boolean;
  saveCredentials?: boolean;
}) {
  const integrations = storage.getIntegrations();
  const dsCur = integrations.deepseek;
  const baseUrl = normalizeBaseUrl(options?.baseUrl || dsCur.baseUrl);
  const modelToTest = (options?.model || dsCur.model || 'deepseek-flash').trim();
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs >= 2000
      ? Math.floor(options.timeoutMs)
      : dsCur.timeoutMs || 25000;
  const maxTokens =
    typeof options?.maxTokens === 'number' && options.maxTokens >= 64
      ? Math.floor(options.maxTokens)
      : dsCur.maxTokens || 1200;
  const quotaLimit =
    typeof options?.quotaLimit === 'number' && options.quotaLimit > 0
      ? Math.floor(options.quotaLimit)
      : dsCur.quotaLimit || 1500;

  const draftKey = typeof options?.apiKey === 'string' ? options.apiKey.trim() : '';
  const effectiveKey = draftKey || storage.getEffectiveDeepSeekKey();

  if (!effectiveKey) {
    storage.updateIntegrations({
      deepseek: {
        ...dsCur,
        baseUrl,
        model: modelToTest,
        timeoutMs,
        maxTokens,
        quotaLimit,
        enabled: false,
        status: 'nao_configurado'
      }
    });
    return {
      valid: false,
      status: 'nao_configurado',
      model: modelToTest,
      baseUrl,
      integrations: storage.getSanitizedIntegrations(),
      error: 'DeepSeek API Key não configurada no servidor. Insira e salve sua chave antes de testar.'
    };
  }

  // Persist user non-secret config + draft key (encrypted) if explicitly testing new credentials
  if (options?.saveCredentials || draftKey) {
    storage.updateIntegrations({
      deepseek: {
        ...(draftKey ? { apiKey: draftKey } : {}),
        baseUrl,
        model: modelToTest,
        timeoutMs,
        maxTokens,
        quotaLimit,
        enabled: options?.enabled ?? true
      }
    });
  }

  // 1) Fetch GET /models first so dynamic model catalog updates whenever possible
  const modelsRes = await fetchDeepSeekModels({ apiKey: effectiveKey, baseUrl });

  // 2) Run minimal real chat completion check (catches 402 Insufficient Balance, 401, invalid model, etc.)
  const chatRes = await callDeepSeekChat({
    apiKey: effectiveKey,
    baseUrl,
    model: modelToTest,
    messages: [{ role: 'user', content: 'Responda apenas com a palavra: OK' }],
    maxTokens: 20,
    timeoutMs,
    expectJson: false
  });

  if (chatRes.ok) {
    storage.recordDeepSeekUsage({
      agentId: 'test',
      model: modelToTest,
      status: 'sucesso',
      httpStatus: chatRes.httpStatus,
      promptTokens: chatRes.promptTokens,
      completionTokens: chatRes.completionTokens,
      totalTokens: chatRes.totalTokens,
      latencyMs: chatRes.latencyMs
    });

    const latestDs = storage.getIntegrations().deepseek;
    const updatedIntegrations = storage.updateIntegrations({
      deepseek: {
        ...latestDs,
        enabled: options?.enabled ?? true,
        baseUrl,
        model: modelToTest,
        timeoutMs,
        maxTokens,
        quotaLimit,
        requestsToday: (latestDs.requestsToday || 0) + 1,
        availableModels: modelsRes.models.length > 0 ? modelsRes.models : latestDs.availableModels,
        status: 'conectado'
      }
    });

    return {
      valid: true,
      status: 'conectado',
      model: modelToTest,
      baseUrl,
      latencyMs: chatRes.latencyMs,
      promptTokens: chatRes.promptTokens,
      completionTokens: chatRes.completionTokens,
      totalTokens: chatRes.totalTokens,
      models: modelsRes.models,
      modelsSource: modelsRes.source,
      integrations: updatedIntegrations,
      message: `API DeepSeek (${modelToTest}) validada e conectada em ${chatRes.latencyMs}ms (resposta: "${chatRes.text || 'OK'}"${
        chatRes.totalTokens ? `, ${chatRes.totalTokens} tokens` : ''
      }).`
    };
  }

  const nextStatus = chatRes.errorStatus || 'erro';
  storage.recordDeepSeekUsage({
    agentId: 'test',
    model: modelToTest,
    status: nextStatus,
    httpStatus: chatRes.httpStatus,
    latencyMs: chatRes.latencyMs,
    errorSummary: chatRes.errorMessage
  });

  const latestDs = storage.getIntegrations().deepseek;
  const updatedIntegrations = storage.updateIntegrations({
    deepseek: {
      ...latestDs,
      baseUrl,
      model: modelToTest,
      timeoutMs,
      maxTokens,
      quotaLimit,
      status: nextStatus
    }
  });

  return {
    valid: false,
    status: nextStatus,
    model: modelToTest,
    baseUrl,
    httpStatus: chatRes.httpStatus,
    latencyMs: chatRes.latencyMs,
    models: modelsRes.models,
    modelsSource: modelsRes.source,
    integrations: updatedIntegrations,
    error: chatRes.errorMessage || 'Falha ao conectar na API DeepSeek.'
  };
}

/**
 * Performs a real HTTP check on a website URL without inventing results.
 */
export async function performRealWebsiteCheck(websiteUrl?: string): Promise<TechnicalAudit> {
  const checkedAt = new Date().toISOString();
  const rawUrl = (websiteUrl || '').trim();

  if (!rawUrl || rawUrl.length < 4) {
    return {
      score: 15,
      hasWebsite: false,
      ssl: false,
      mobileReady: false,
      speedScore: 0,
      domainAvailable: true,
      issues: ['Nenhum website informado para a empresa'],
      recommendedService: 'Criação de Website Institucional',
      checkedAt
    };
  }

  let normalizedUrl = rawUrl;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return {
      score: 20,
      hasWebsite: true,
      ssl: false,
      mobileReady: false,
      speedScore: 0,
      domainAvailable: false,
      issues: [`URL inválida informada: "${rawUrl}"`],
      recommendedService: 'Diagnóstico e Correção de Domínio',
      checkedAt,
      error: 'Formato de URL inválido.'
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'FMWS-Technical-Auditor/1.0'
      }
    });
    clearTimeout(timeout);
    const responseTimeMs = Date.now() - start;
    const finalUrl = response.url || parsedUrl.toString();
    const ssl = finalUrl.startsWith('https://');

    const contentType = response.headers.get('content-type') || '';
    let html = '';
    if (contentType.includes('text/html')) {
      html = (await response.text()).slice(0, 120000);
    }

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120) : undefined;
    const hasMetaDesc = /<meta[^>]+name=["']description["']/i.test(html);

    const issues: string[] = [];
    let score = 100;

    if (!response.ok) {
      issues.push(`Servidor retornou status HTTP ${response.status}`);
      score -= 35;
    }
    if (!ssl) {
      issues.push('Site sem HTTPS/SSL ativo');
      score -= 30;
    }
    if (html && !hasViewport) {
      issues.push('Meta tag viewport ausente (possível falha de responsividade mobile)');
      score -= 20;
    }
    if (html && !hasMetaDesc) {
      issues.push('Meta description de SEO não encontrada');
      score -= 10;
    }
    if (responseTimeMs > 2500) {
      issues.push(`Tempo de resposta elevado (${responseTimeMs}ms)`);
      score -= 15;
    } else if (responseTimeMs > 1200) {
      issues.push(`Tempo de resposta moderado (${responseTimeMs}ms)`);
      score -= 5;
    }

    if (issues.length === 0) {
      issues.push('Nenhum erro crítico detectado na verificação HTTP básica');
    }

    const speedScore = Math.max(0, Math.min(100, Math.round(100 - responseTimeMs / 45)));

    return {
      score: Math.max(0, Math.min(100, score)),
      hasWebsite: true,
      ssl,
      mobileReady: hasViewport,
      speedScore,
      domainAvailable: false,
      issues,
      recommendedService:
        !ssl || !hasViewport || !response.ok
          ? 'Reformulação & Otimização Técnica'
          : 'Manutenção / Evolução SEO',
      checkedAt,
      httpStatus: response.status,
      responseTimeMs,
      pageTitle
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const responseTimeMs = Date.now() - start;
    const msg = err?.name === 'AbortError' ? 'Timeout acima de 8 segundos ao acessar o site' : err?.message || 'Erro de conexão';
    return {
      score: 20,
      hasWebsite: true,
      ssl: false,
      mobileReady: false,
      speedScore: 0,
      domainAvailable: false,
      issues: [`Falha real ao acessar ${parsedUrl.hostname}: ${msg}`],
      recommendedService: 'Hospedagem Cloud + Reconstrução Web',
      checkedAt,
      responseTimeMs,
      error: msg
    };
  }
}

export async function testGeminiIntegration(requestedModel?: string) {
  const integrations = storage.getIntegrations();
  const modelToTest = (requestedModel || integrations.gemini.model || 'gemini-4-hydrogen').trim();
  const client = getAIClient();

  if (!client) {
    storage.updateIntegrations({
      gemini: {
        ...integrations.gemini,
        enabled: false,
        model: modelToTest,
        status: 'nao_configurado'
      }
    });
    return {
      valid: false,
      status: 'nao_configurado',
      model: modelToTest,
      integrations: storage.getSanitizedIntegrations(),
      error:
        'Variável GEMINI_API_KEY não encontrada no servidor. Configure sua chave no painel Settings > Secrets do ambiente.'
    };
  }

  try {
    const start = Date.now();
    const response = await client.models.generateContent({
      model: modelToTest,
      contents: 'Responda apenas com a palavra: OK'
    });
    const latencyMs = Date.now() - start;

    const updatedIntegrations = storage.updateIntegrations({
      gemini: {
        ...integrations.gemini,
        enabled: true,
        model: modelToTest,
        requestsToday: integrations.gemini.requestsToday + 1,
        status: 'conectado'
      }
    });

    return {
      valid: true,
      status: 'conectado',
      model: modelToTest,
      latencyMs,
      integrations: updatedIntegrations,
      message: `API Gemini (${modelToTest}) validada e conectada em ${latencyMs}ms (resposta: "${(response.text || 'OK').trim()}").`
    };
  } catch (err: any) {
    const msg = String(err?.message || 'Falha na comunicação com Gemini');
    const isQuota = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
    const isAuth = msg.includes('400') || msg.includes('403') || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED');
    const isModelNotFound = msg.includes('404') || msg.includes('NOT_FOUND');

    const nextStatus = isQuota ? 'limite_atingido' : 'erro';
    const updatedIntegrations = storage.updateIntegrations({
      gemini: {
        ...integrations.gemini,
        model: modelToTest,
        status: nextStatus
      }
    });

    const friendlyError = isAuth
      ? `Chave GEMINI_API_KEY inválida ou sem permissão (${msg}). Verifique em Settings > Secrets.`
      : isModelNotFound
      ? `Modelo "${modelToTest}" indisponível ou não encontrado (${msg}). Selecione outro modelo (ex: gemini-4-hydrogen ou gemini-3.1-flash-lite).`
      : `Falha ao conectar no Gemini (${modelToTest}): ${msg}`;

    return {
      valid: false,
      status: nextStatus,
      model: modelToTest,
      integrations: updatedIntegrations,
      error: friendlyError
    };
  }
}

interface ProviderCallSpec {
  agentId: 'atendente' | 'prospector';
  systemPrompt?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  geminiPrompt: string;
  expectJson: boolean;
}

interface SingleProviderAttempt {
  ok: boolean;
  provider: AIProvider;
  model: string;
  text: string;
  reasoningContent?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  httpStatus?: number;
  status: 'sucesso' | 'erro' | 'sem_saldo' | 'limite_atingido' | 'nao_configurado';
  errorCode?: string;
  errorMessage?: string;
  transient: boolean;
}

async function runSingleProviderAttempt(
  provider: AIProvider,
  model: string,
  spec: ProviderCallSpec
): Promise<SingleProviderAttempt> {
  const integrations = storage.getIntegrations();

  if (provider === 'deepseek') {
    const ds = integrations.deepseek;
    const apiKey = storage.getEffectiveDeepSeekKey();

    if (!apiKey) {
      storage.updateIntegrations({ deepseek: { ...ds, status: 'nao_configurado' } });
      return {
        ok: false,
        provider: 'deepseek',
        model,
        text: '',
        status: 'nao_configurado',
        errorCode: 'NO_API_KEY',
        errorMessage: 'DeepSeek API Key não configurada no servidor (Configurações > DeepSeek API).',
        transient: true
      };
    }

    if (!ds.enabled) {
      return {
        ok: false,
        provider: 'deepseek',
        model,
        text: '',
        status: 'erro',
        errorCode: 'PROVIDER_DISABLED',
        errorMessage: 'A integração DeepSeek API está desativada em Configurações > DeepSeek API.',
        transient: true
      };
    }

    if (ds.requestsToday >= ds.quotaLimit) {
      storage.updateIntegrations({ deepseek: { ...ds, status: 'limite_atingido' } });
      storage.recordDeepSeekUsage({
        agentId: spec.agentId,
        model,
        status: 'limite_atingido',
        errorSummary: `Cota diária atingida (${ds.requestsToday}/${ds.quotaLimit})`
      });
      return {
        ok: false,
        provider: 'deepseek',
        model,
        text: '',
        status: 'limite_atingido',
        errorCode: 'QUOTA_EXCEEDED',
        errorMessage: `Limite diário da DeepSeek atingido (${ds.requestsToday}/${ds.quotaLimit}). Ajuste a cota em Configurações.`,
        transient: true
      };
    }

    const res = await callDeepSeekChat({
      apiKey,
      baseUrl: ds.baseUrl,
      model,
      messages: spec.messages,
      maxTokens: ds.maxTokens,
      timeoutMs: ds.timeoutMs,
      expectJson: spec.expectJson
    });

    if (res.ok) {
      storage.recordDeepSeekUsage({
        agentId: spec.agentId,
        model,
        status: 'sucesso',
        httpStatus: res.httpStatus,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        latencyMs: res.latencyMs
      });
      const latestDs = storage.getIntegrations().deepseek;
      storage.updateIntegrations({
        deepseek: {
          ...latestDs,
          requestsToday: (latestDs.requestsToday || 0) + 1,
          status: 'conectado'
        }
      });
      return {
        ok: true,
        provider: 'deepseek',
        model,
        text: res.text,
        reasoningContent: res.reasoningContent,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        totalTokens: res.totalTokens,
        latencyMs: res.latencyMs,
        httpStatus: res.httpStatus,
        status: 'sucesso',
        transient: false
      };
    }

    const errStatus = res.errorStatus || 'erro';
    storage.recordDeepSeekUsage({
      agentId: spec.agentId,
      model,
      status: errStatus,
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      errorSummary: res.errorMessage
    });
    const latestDs = storage.getIntegrations().deepseek;
    storage.updateIntegrations({
      deepseek: {
        ...latestDs,
        status: errStatus
      }
    });

    return {
      ok: false,
      provider: 'deepseek',
      model,
      text: '',
      latencyMs: res.latencyMs,
      httpStatus: res.httpStatus,
      status: errStatus,
      errorCode: res.errorCode,
      errorMessage: res.errorMessage,
      transient: res.transient
    };
  }

  // Gemini Provider
  const client = getAIClient();
  const safeGeminiModel = model.startsWith('gemini-2.') ? 'gemini-4-hydrogen' : model;

  if (!client) {
    return {
      ok: false,
      provider: 'gemini',
      model: safeGeminiModel,
      text: '',
      status: 'nao_configurado',
      errorCode: 'NO_API_KEY',
      errorMessage: 'GEMINI_API_KEY não configurada no servidor (Settings > Secrets).',
      transient: true
    };
  }

  if (!integrations.gemini.enabled) {
    return {
      ok: false,
      provider: 'gemini',
      model: safeGeminiModel,
      text: '',
      status: 'erro',
      errorCode: 'PROVIDER_DISABLED',
      errorMessage: 'A API Google Gemini está desativada em Configurações > Google Gemini API.',
      transient: true
    };
  }

  if (integrations.gemini.requestsToday >= integrations.gemini.quotaLimit) {
    storage.updateIntegrations({
      gemini: { ...integrations.gemini, status: 'limite_atingido' }
    });
    return {
      ok: false,
      provider: 'gemini',
      model: safeGeminiModel,
      text: '',
      status: 'limite_atingido',
      errorCode: 'QUOTA_EXCEEDED',
      errorMessage: `Limite diário do Gemini atingido (${integrations.gemini.requestsToday}/${integrations.gemini.quotaLimit}). Ajuste a cota em Configurações.`,
      transient: true
    };
  }

  const start = Date.now();
  try {
    const response = await client.models.generateContent({
      model: safeGeminiModel,
      contents: spec.geminiPrompt,
      ...(spec.expectJson
        ? {
            config: {
              responseMimeType: 'application/json'
            }
          }
        : {})
    });
    const latencyMs = Date.now() - start;
    const usageMeta = (response as any)?.usageMetadata || {};
    const promptTokens =
      typeof usageMeta.promptTokenCount === 'number' ? usageMeta.promptTokenCount : undefined;
    const completionTokens =
      typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : undefined;
    const totalTokens =
      typeof usageMeta.totalTokenCount === 'number'
        ? usageMeta.totalTokenCount
        : promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens || 0) + (completionTokens || 0)
        : undefined;

    const latestGemini = storage.getIntegrations().gemini;
    storage.updateIntegrations({
      gemini: {
        ...latestGemini,
        requestsToday: (latestGemini.requestsToday || 0) + 1,
        status: 'conectado'
      }
    });

    return {
      ok: true,
      provider: 'gemini',
      model: safeGeminiModel,
      text: String(response.text || '').trim(),
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      httpStatus: 200,
      status: 'sucesso',
      transient: false
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const msg = sanitizeHttpMessage(err?.message || 'Falha na comunicação com Gemini');
    const isQuota = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
    const isAuth =
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('PERMISSION_DENIED');
    const is5xx = /\b50[0-9]\b/.test(msg) || msg.toLowerCase().includes('unavailable');
    const httpStatus = isQuota ? 429 : isAuth ? 403 : is5xx ? 503 : 500;

    const latestGemini = storage.getIntegrations().gemini;
    storage.updateIntegrations({
      gemini: {
        ...latestGemini,
        status: isQuota ? 'limite_atingido' : 'erro'
      }
    });

    return {
      ok: false,
      provider: 'gemini',
      model: safeGeminiModel,
      text: '',
      latencyMs,
      httpStatus,
      status: isQuota ? 'limite_atingido' : 'erro',
      errorCode: `HTTP_${httpStatus}`,
      errorMessage: `Erro na execução do modelo Gemini (${safeGeminiModel}): ${msg}`,
      transient: isQuota || is5xx
    };
  }
}

async function executeAgentWithOptionalFallback(spec: ProviderCallSpec): Promise<
  SingleProviderAttempt & { fallbackUsed: boolean; primaryError?: string }
> {
  const agent = storage.getAIAgents().find((a) => a.id === spec.agentId);
  const integrations = storage.getIntegrations();

  const primaryProvider: AIProvider = agent?.provider === 'deepseek' ? 'deepseek' : 'gemini';
  const primaryModel =
    (agent?.model && agent.model.trim()) ||
    (primaryProvider === 'deepseek'
      ? integrations.deepseek.model || 'deepseek-flash'
      : integrations.gemini.model || 'gemini-4-hydrogen');

  const primaryAttempt = await runSingleProviderAttempt(primaryProvider, primaryModel, spec);

  if (primaryAttempt.ok) {
    storage.recordAIAgentExecution(spec.agentId, {
      provider: primaryAttempt.provider,
      model: primaryAttempt.model,
      status: 'sucesso',
      httpStatus: primaryAttempt.httpStatus,
      latencyMs: primaryAttempt.latencyMs,
      promptTokens: primaryAttempt.promptTokens,
      completionTokens: primaryAttempt.completionTokens,
      totalTokens: primaryAttempt.totalTokens,
      fallbackUsed: false
    });
    return { ...primaryAttempt, fallbackUsed: false };
  }

  // Fallback runs ONLY if explicitly authorized on the agent, targets the secondary provider,
  // and primary failed due to unavailability / quota / rate limit / timeout (at most 1 attempt).
  const fallbackProvider = agent?.fallbackProvider;
  const fallbackAuthorized = Boolean(
    agent?.fallbackEnabled === true &&
      fallbackProvider &&
      fallbackProvider !== primaryProvider &&
      primaryAttempt.transient
  );

  if (fallbackAuthorized && fallbackProvider) {
    const fallbackModel =
      (agent?.fallbackModel && agent.fallbackModel.trim()) ||
      (fallbackProvider === 'deepseek'
        ? integrations.deepseek.model || 'deepseek-flash'
        : integrations.gemini.model || 'gemini-4-hydrogen');

    const secondaryAttempt = await runSingleProviderAttempt(fallbackProvider, fallbackModel, spec);
    storage.recordAIAgentExecution(spec.agentId, {
      provider: secondaryAttempt.provider,
      model: secondaryAttempt.model,
      status: secondaryAttempt.status,
      httpStatus: secondaryAttempt.httpStatus,
      errorCode: secondaryAttempt.errorCode,
      errorMessage: secondaryAttempt.errorMessage,
      latencyMs: secondaryAttempt.latencyMs,
      promptTokens: secondaryAttempt.promptTokens,
      completionTokens: secondaryAttempt.completionTokens,
      totalTokens: secondaryAttempt.totalTokens,
      fallbackUsed: true
    });
    return {
      ...secondaryAttempt,
      fallbackUsed: true,
      primaryError: primaryAttempt.errorMessage
    };
  }

  storage.recordAIAgentExecution(spec.agentId, {
    provider: primaryAttempt.provider,
    model: primaryAttempt.model,
    status: primaryAttempt.status,
    httpStatus: primaryAttempt.httpStatus,
    errorCode: primaryAttempt.errorCode,
    errorMessage: primaryAttempt.errorMessage,
    latencyMs: primaryAttempt.latencyMs,
    fallbackUsed: false
  });

  return { ...primaryAttempt, fallbackUsed: false };
}

export async function testAgentConnection(agentId: 'atendente' | 'prospector') {
  const agent = storage.getAIAgents().find((a) => a.id === agentId);
  if (!agent) {
    throw new Error('Agente de IA não encontrado.');
  }

  const integrations = storage.getIntegrations();
  const primaryProvider: AIProvider = agent.provider === 'deepseek' ? 'deepseek' : 'gemini';
  const modelToUse =
    (agent.model && agent.model.trim()) ||
    (primaryProvider === 'deepseek'
      ? integrations.deepseek.model || 'deepseek-flash'
      : integrations.gemini.model || 'gemini-4-hydrogen');

  const execRes = await executeAgentWithOptionalFallback({
    agentId,
    messages: [{ role: 'user', content: 'Responda apenas com a palavra: OK' }],
    geminiPrompt: 'Responda apenas com a palavra: OK',
    expectJson: false
  });

  const updatedAgent = storage.getAIAgents().find((a) => a.id === agentId) || agent;
  const freshIntegrations = storage.getSanitizedIntegrations();

  if (!execRes.ok) {
    updatedAgent.status = execRes.status === 'nao_configurado' ? 'nao_configurado' : 'erro';
    storage.updateAIAgent(updatedAgent);

    return {
      ok: false,
      agent: updatedAgent,
      integrations: freshIntegrations,
      providerUsed: execRes.provider,
      modelUsed: execRes.model,
      fallbackUsed: execRes.fallbackUsed,
      error: execRes.errorMessage || `Falha ao validar ${updatedAgent.name}.`,
      diagnostics: {
        provider: execRes.provider,
        model: execRes.model,
        gemini: freshIntegrations.gemini.status,
        deepseek: freshIntegrations.deepseek.status,
        latencyMs: execRes.latencyMs,
        httpStatus: execRes.httpStatus,
        totalTokens: execRes.totalTokens,
        metaCloud: freshIntegrations.metaCloud.status,
        googlePlaces: freshIntegrations.googlePlaces.status
      }
    };
  }

  updatedAgent.status = 'ativo';
  storage.updateAIAgent(updatedAgent);

  const providerLabel = execRes.provider === 'deepseek' ? 'DeepSeek' : 'Google Gemini';
  const channelNote =
    agentId === 'atendente'
      ? freshIntegrations.metaCloud.status === 'conectado'
        ? `${providerLabel} e WhatsApp Meta Cloud conectados.`
        : `${providerLabel} conectado (modo Laboratório/Simulação ativo; configure Meta Cloud API para disparos reais no WhatsApp).`
      : freshIntegrations.googlePlaces.status === 'conectado'
      ? `${providerLabel} e Google Places conectados para radar automático e auditoria.`
      : `${providerLabel} conectado para auditoria HTTP real e redação comercial (Google Places permanece desativado até configurar chave).`;

  const fallbackNote = execRes.fallbackUsed ? ` [Fallback ativado de ${primaryProvider} para ${execRes.provider}]` : '';

  return {
    ok: true,
    agent: updatedAgent,
    integrations: freshIntegrations,
    providerUsed: execRes.provider,
    modelUsed: execRes.model,
    fallbackUsed: execRes.fallbackUsed,
    message: `Agente ${updatedAgent.name} validado via ${providerLabel} (${execRes.model}) em ${execRes.latencyMs}ms ("${
      execRes.text || 'OK'
    }").${fallbackNote} ${channelNote}`,
    diagnostics: {
      provider: execRes.provider,
      model: execRes.model,
      gemini: freshIntegrations.gemini.status,
      deepseek: freshIntegrations.deepseek.status,
      latencyMs: execRes.latencyMs,
      promptTokens: execRes.promptTokens,
      completionTokens: execRes.completionTokens,
      totalTokens: execRes.totalTokens,
      metaCloud: freshIntegrations.metaCloud.status,
      googlePlaces: freshIntegrations.googlePlaces.status
    }
  };
}

function validateAtendenteReply(
  rawReply: string,
  services: ReturnType<typeof storage.getServices>
): { text: string; adjusted: boolean; forceHandover: boolean } {
  let text = String(rawReply || '').trim();
  if (!text) {
    return {
      text: 'Olá! Como posso ajudar você e sua empresa hoje na Fazer Meu Website?',
      adjusted: true,
      forceHandover: false
    };
  }

  let adjusted = false;
  let forceHandover = false;

  // Validate any currency mentions (R$ ...) against the official catalog
  const priceMatches = text.match(/R\$\s*[\d.,]+/gi);
  if (priceMatches && priceMatches.length > 0) {
    const allowedNumbers = new Set(
      services.map((s) => Number(s.basePrice || 0).toFixed(2))
    );
    const hasUngroundedPrice = priceMatches.some((raw) => {
      const normalized = raw
        .replace(/R\$/i, '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.');
      const num = Number(normalized);
      if (!Number.isFinite(num)) return true;
      return !allowedNumbers.has(num.toFixed(2));
    });

    if (services.length === 0 || hasUngroundedPrice) {
      adjusted = true;
      forceHandover = true;
      text =
        services.length === 0
          ? 'Para informar valores e prazos exatos de acordo com o escopo do seu projeto, vou encaminhar seu atendimento para um consultor da Fazer Meu Website preparar o orçamento oficial.'
          : 'Os investimentos dependem do plano selecionado no nosso catálogo oficial. Vou encaminhar sua solicitação para um consultor confirmar os valores e prazos exatos com você.';
    }
  }

  // Guard against unconfirmed immediate service / impossible fast-delivery promises
  if (/atendimento imediato|agora mesmo um humano|entrega em \d+ hora/i.test(text)) {
    adjusted = true;
    forceHandover = true;
    text = text.replace(/atendimento imediato|agora mesmo um humano/gi, 'nosso time comercial assim que possível');
  }

  return { text, adjusted, forceHandover };
}

export async function generateAtendenteResponse(params: {
  contactName: string;
  incomingText: string;
  chatHistory: Array<{ sender: string; text: string }>;
  leadContext?: Partial<Lead>;
}): Promise<{
  replyText: string;
  shouldHandover: boolean;
  suggestedLeadStatus?: string;
  providerUsed?: AIProvider;
  modelUsed?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  totalTokens?: number;
  error?: string;
}> {
  const atendenteConfig = storage.getAIAgents().find((a) => a.id === 'atendente');

  if (atendenteConfig?.status === 'pausado') {
    return {
      replyText: '',
      shouldHandover: true,
      error: 'O Atendente IA está pausado no painel de Governança. Ative-o para gerar respostas automáticas.'
    };
  }

  const services = storage.getServices();
  const servicesSummary =
    services.length > 0
      ? services
          .map(
            (s) =>
              `- ${s.name}: R$ ${s.basePrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${
                s.billingCycle === 'mensal' ? 'mensal' : s.billingCycle === 'anual' ? 'anual' : 'taxa única'
              }). Detalhes: ${s.description || 'Conforme catálogo oficial FMWS'}`
          )
          .join('\n')
      : 'Tabela de serviços ainda não cadastrada. NÃO cite nenhum valor em reais (R$). Informe que um consultor humano enviará o orçamento personalizado e acione shouldHandover=true se o cliente pedir preço.';

  const rulesSummary =
    atendenteConfig?.rules && atendenteConfig.rules.length > 0
      ? atendenteConfig.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '1. Respostas objetivas e naturais para WhatsApp.';

  const leadSnippet = params.leadContext
    ? `\nContexto do Lead/Cliente no CRM: Empresa="${params.leadContext.company || 'Não informada'}", Segmento="${params.leadContext.segment || 'Não informado'}", Etapa="${params.leadContext.status || 'novo'}".`
    : '';

  const systemPrompt = `Você é ${atendenteConfig?.name || 'Atendente IA FMWS'}, a atendente virtual e especialista em consultoria digital da Fazer Meu Website.
Personalidade: ${atendenteConfig?.personality || 'Cordial, profissional e ágil'}.

Catálogo Oficial de Serviços e Preços:
${servicesSummary}

Instruções Específicas:
${atendenteConfig?.instructions || 'Atenda pelo WhatsApp e qualifique o cliente com objetividade.'}

Regras Obrigatórias de Conformidade FMWS:
${rulesSummary}
- NUNCA invente preços, descontos ou prazos que não constem no Catálogo Oficial acima.
- NUNCA prometa atendimento humano imediato sem confirmação; informe que a solicitação foi encaminhada para a equipe.
- NUNCA dispare ou sugira prospecção fria automática.
- Se o cliente solicitar explicitamente falar com um atendente humano, gerente, suporte técnico avançado ou vendedor, responda com gentileza dizendo que está encaminhando para a equipe humana e retorne "shouldHandover": true.
- Se o cliente pedir orçamento formal e não houver plano exato no catálogo, confirme os dados (empresa, segmento, objetivo) e retorne "shouldHandover": true.

IMPORTANTE: Retorne a resposta em formato JSON estrito:
{
  "replyText": "texto da resposta para o WhatsApp",
  "shouldHandover": true ou false,
  "suggestedLeadStatus": "qualificacao" | "proposta" | "negociacao" | "suporte"
}`;

  const recentHistory = params.chatHistory.slice(-10);
  const deepSeekMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: `${systemPrompt}${leadSnippet}`
    }
  ];
  for (const h of recentHistory) {
    const cleanText = String(h.text || '').trim();
    if (!cleanText) continue;
    deepSeekMessages.push({
      role: h.sender === 'contact' ? 'user' : 'assistant',
      content: cleanText
    });
  }
  const lastHist = deepSeekMessages[deepSeekMessages.length - 1];
  if (!lastHist || lastHist.role !== 'user' || lastHist.content !== params.incomingText.trim()) {
    deepSeekMessages.push({
      role: 'user',
      content: `Mensagem de ${params.contactName}: ${params.incomingText}\n\nResponda exclusivamente em formato JSON válido.`
    });
  } else {
    deepSeekMessages[deepSeekMessages.length - 1] = {
      role: 'user',
      content: `Mensagem de ${params.contactName}: ${lastHist.content}\n\nResponda exclusivamente em formato JSON válido.`
    };
  }

  const historyContext = params.chatHistory
    .slice(-8)
    .map((h) => `${h.sender === 'contact' ? params.contactName : 'Atendente'}: ${h.text}`)
    .join('\n');

  const geminiPrompt = `${systemPrompt}\n\nHistórico recente da conversa:${leadSnippet}
${historyContext || 'Início de atendimento'}

Nova mensagem recebida de ${params.contactName}:
"${params.incomingText}"

Responda em formato JSON.`;

  const execRes = await executeAgentWithOptionalFallback({
    agentId: 'atendente',
    systemPrompt,
    messages: deepSeekMessages,
    geminiPrompt,
    expectJson: true
  });

  if (!execRes.ok) {
    return {
      replyText: '',
      shouldHandover: true,
      providerUsed: execRes.provider,
      modelUsed: execRes.model,
      fallbackUsed: execRes.fallbackUsed,
      latencyMs: execRes.latencyMs,
      error: execRes.errorMessage || 'Falha ao executar modelo de IA para o Atendente IA.'
    };
  }

  const latestAgent = storage.getAIAgents().find((a) => a.id === 'atendente');
  if (latestAgent) {
    latestAgent.stats.interactionsToday += 1;
    latestAgent.stats.tasksCompleted += 1;
    latestAgent.status = 'ativo';
    storage.updateAIAgent(latestAgent);
  }

  const parsed = extractJsonObject(execRes.text);
  const rawReplyText =
    parsed && typeof parsed.replyText === 'string' ? parsed.replyText : execRes.text;
  const validated = validateAtendenteReply(rawReplyText, services);

  return {
    replyText: validated.text,
    shouldHandover: Boolean(parsed?.shouldHandover) || validated.forceHandover,
    suggestedLeadStatus: parsed?.suggestedLeadStatus,
    providerUsed: execRes.provider,
    modelUsed: execRes.model,
    fallbackUsed: execRes.fallbackUsed,
    latencyMs: execRes.latencyMs,
    totalTokens: execRes.totalTokens
  };
}

export async function runProspectorAudit(params: {
  companyName: string;
  segment: string;
  city: string;
  state: string;
  websiteUrl?: string;
}): Promise<{
  audit: TechnicalAudit;
  pitchDraft?: string;
  aiInsights?: string;
  geminiUsed: boolean;
  aiUsed: boolean;
  providerUsed?: AIProvider;
  modelUsed?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  totalTokens?: number;
  warning?: string;
}> {
  // Always perform real technical HTTP check first (never fabricate technical measurements)
  const realAudit = await performRealWebsiteCheck(params.websiteUrl);
  const prospectorConfig = storage.getAIAgents().find((a) => a.id === 'prospector');

  if (prospectorConfig?.status === 'pausado') {
    return {
      audit: realAudit,
      geminiUsed: false,
      aiUsed: false,
      warning: 'Auditoria técnica HTTP concluída. O Prospector IA está pausado nas configurações do agente.'
    };
  }

  const systemPrompt = `Você é ${prospectorConfig?.name || 'Prospector IA FMWS'} da agência Fazer Meu Website.
Personalidade: ${prospectorConfig?.personality || 'Analítico e consultivo'}.
Instruções operacionais:
${prospectorConfig?.instructions || 'Analise os dados técnicos reais e elabore diagnóstico e pitch comercial respeitoso.'}

REGRAS OBRIGATÓRIAS:
- Baseie-se EXCLUSIVAMENTE nos dados técnicos reais medidos e informados.
- Retorne exclusivamente JSON estrito no formato:
{
  "pitchDraft": "Mensagem respeitosa e curta para WhatsApp citando apenas fatos reais observados",
  "aiInsights": "Resumo estratégico objetivo para o vendedor humano"
}`;

  const userPrompt = `Empresa: ${params.companyName}
Segmento: ${params.segment}
Localização: ${params.city} - ${params.state}
Website informado: ${params.websiteUrl || 'Nenhum'}
Resultado técnico real observado:
- Possui website: ${realAudit.hasWebsite ? 'Sim' : 'Não'}
- HTTPS/SSL ativo: ${realAudit.ssl ? 'Sim' : 'Não'}
- Viewport mobile detectada: ${realAudit.mobileReady ? 'Sim' : 'Não'}
- HTTP Status: ${realAudit.httpStatus ?? 'N/A'}
- Tempo de resposta real: ${realAudit.responseTimeMs !== undefined ? `${realAudit.responseTimeMs}ms` : 'N/A'}
- Pontos observados: ${realAudit.issues.join('; ')}

Retorne JSON estrito com "pitchDraft" e "aiInsights".`;

  const execRes = await executeAgentWithOptionalFallback({
    agentId: 'prospector',
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    geminiPrompt: `${systemPrompt}\n\n${userPrompt}`,
    expectJson: true
  });

  if (!execRes.ok) {
    return {
      audit: realAudit,
      geminiUsed: false,
      aiUsed: false,
      providerUsed: execRes.provider,
      modelUsed: execRes.model,
      fallbackUsed: execRes.fallbackUsed,
      latencyMs: execRes.latencyMs,
      warning: `Auditoria técnica HTTP concluída, mas a redação por IA (${execRes.provider}) falhou: ${
        execRes.errorMessage || 'provedor indisponível'
      }`
    };
  }

  const latestProspector = storage.getAIAgents().find((a) => a.id === 'prospector');
  if (latestProspector) {
    latestProspector.stats.interactionsToday += 1;
    latestProspector.stats.leadsHandled += 1;
    latestProspector.status = 'ativo';
    storage.updateAIAgent(latestProspector);
  }

  const parsed = extractJsonObject(execRes.text) || {};
  return {
    audit: realAudit,
    pitchDraft: typeof parsed.pitchDraft === 'string' ? parsed.pitchDraft : execRes.text,
    aiInsights: typeof parsed.aiInsights === 'string' ? parsed.aiInsights : '',
    geminiUsed: true,
    aiUsed: true,
    providerUsed: execRes.provider,
    modelUsed: execRes.model,
    fallbackUsed: execRes.fallbackUsed,
    latencyMs: execRes.latencyMs,
    totalTokens: execRes.totalTokens
  };
}
