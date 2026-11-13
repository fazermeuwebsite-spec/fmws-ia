import { GoogleGenAI } from '@google/genai';
import { storage } from './storage';
import { TechnicalAudit, Lead } from '../types';

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

export async function testAgentConnection(agentId: 'atendente' | 'prospector') {
  const agent = storage.getAIAgents().find((a) => a.id === agentId);
  if (!agent) {
    throw new Error('Agente de IA não encontrado.');
  }

  const integrations = storage.getIntegrations();
  const client = getAIClient();

  if (!client) {
    agent.status = 'nao_configurado';
    storage.updateAIAgent(agent);
    return {
      ok: false,
      agent,
      integrations: storage.getSanitizedIntegrations(),
      error: 'GEMINI_API_KEY não configurada no servidor (Settings > Secrets).',
      diagnostics: {
        gemini: 'nao_configurado',
        metaCloud: integrations.metaCloud.status,
        googlePlaces: integrations.googlePlaces.status
      }
    };
  }

  if (!integrations.gemini.enabled) {
    return {
      ok: false,
      agent,
      integrations: storage.getSanitizedIntegrations(),
      error: 'A API Google Gemini está desativada em Configurações > Google Gemini API.',
      diagnostics: {
        gemini: integrations.gemini.status,
        metaCloud: integrations.metaCloud.status,
        googlePlaces: integrations.googlePlaces.status
      }
    };
  }

  try {
    const start = Date.now();
    const modelToUse = agent.model || integrations.gemini.model || 'gemini-4-hydrogen';
    const response = await client.models.generateContent({
      model: modelToUse,
      contents: 'Responda apenas com a palavra: OK'
    });
    const latencyMs = Date.now() - start;

    integrations.gemini.requestsToday += 1;
    integrations.gemini.enabled = true;
    integrations.gemini.status = 'conectado';
    storage.updateIntegrations({ gemini: integrations.gemini });

    agent.status = 'ativo';
    storage.updateAIAgent(agent);

    const channelNote =
      agentId === 'atendente'
        ? integrations.metaCloud.status === 'conectado'
          ? 'Gemini e WhatsApp Meta Cloud conectados.'
          : 'Gemini conectado (modo Laboratório/Simulação ativo; configure Meta Cloud API para disparos reais no WhatsApp).'
        : integrations.googlePlaces.status === 'conectado'
        ? 'Gemini e Google Places conectados para radar automático e auditoria.'
        : 'Gemini conectado para auditoria HTTP real e redação comercial (Google Places permanece desativado até configurar chave).';

    return {
      ok: true,
      agent,
      integrations: storage.getSanitizedIntegrations(),
      message: `Agente ${agent.name} validado com sucesso em ${latencyMs}ms (${(response.text || 'OK').trim()}). ${channelNote}`,
      diagnostics: {
        gemini: 'conectado',
        latencyMs,
        metaCloud: integrations.metaCloud.status,
        googlePlaces: integrations.googlePlaces.status
      }
    };
  } catch (err: any) {
    const msg = String(err?.message || 'Falha na comunicação com Gemini');
    const isQuota = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED');

    integrations.gemini.status = isQuota ? 'limite_atingido' : 'erro';
    storage.updateIntegrations({ gemini: integrations.gemini });

    agent.status = 'erro';
    storage.updateAIAgent(agent);

    return {
      ok: false,
      agent,
      integrations: storage.getSanitizedIntegrations(),
      error: `Falha ao validar ${agent.name} no Gemini: ${msg}`,
      diagnostics: {
        gemini: integrations.gemini.status,
        metaCloud: integrations.metaCloud.status,
        googlePlaces: integrations.googlePlaces.status
      }
    };
  }
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
}): Promise<{ replyText: string; shouldHandover: boolean; suggestedLeadStatus?: string; error?: string }> {
  const atendenteConfig = storage.getAIAgents().find((a) => a.id === 'atendente');
  const integrations = storage.getIntegrations();
  const client = getAIClient();

  if (!client) {
    return {
      replyText: '',
      shouldHandover: true,
      error: 'Agente Atendente IA não configurado. Verifique GEMINI_API_KEY em Settings > Secrets.'
    };
  }

  if (!integrations.gemini.enabled) {
    return {
      replyText: '',
      shouldHandover: true,
      error: 'A API Google Gemini está desativada em Configurações > Google Gemini API.'
    };
  }

  if (integrations.gemini.requestsToday >= integrations.gemini.quotaLimit) {
    storage.updateIntegrations({
      gemini: { ...integrations.gemini, status: 'limite_atingido' }
    });
    return {
      replyText: '',
      shouldHandover: true,
      error: `Limite diário do Gemini atingido (${integrations.gemini.requestsToday}/${integrations.gemini.quotaLimit}). Ajuste a cota em Configurações.`
    };
  }

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

  try {
    const historyContext = params.chatHistory
      .slice(-8)
      .map((h) => `${h.sender === 'contact' ? params.contactName : 'Atendente'}: ${h.text}`)
      .join('\n');

    const userPrompt = `Histórico recente da conversa:${leadSnippet}
${historyContext || 'Início de atendimento'}

Nova mensagem recebida de ${params.contactName}:
"${params.incomingText}"

Responda em formato JSON.`;

    const modelName = atendenteConfig?.model || integrations.gemini.model || 'gemini-4-hydrogen';
    const response = await client.models.generateContent({
      model: modelName.startsWith('gemini-2.') ? 'gemini-4-hydrogen' : modelName,
      contents: `${systemPrompt}\n\n${userPrompt}`,
      config: {
        responseMimeType: 'application/json'
      }
    });

    if (atendenteConfig) {
      atendenteConfig.stats.interactionsToday += 1;
      atendenteConfig.stats.tasksCompleted += 1;
      atendenteConfig.status = 'ativo';
      storage.updateAIAgent(atendenteConfig);
    }
    integrations.gemini.requestsToday += 1;
    integrations.gemini.status = 'conectado';
    storage.updateIntegrations({ gemini: integrations.gemini });

    const responseText = response.text || '';
    const parsed = JSON.parse(responseText);
    const validated = validateAtendenteReply(parsed.replyText, services);

    return {
      replyText: validated.text,
      shouldHandover: Boolean(parsed.shouldHandover) || validated.forceHandover,
      suggestedLeadStatus: parsed.suggestedLeadStatus
    };
  } catch (err: any) {
    console.error('Error invoking Gemini for Atendente IA:', err);
    const msg = String(err?.message || '');
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      integrations.gemini.status = 'limite_atingido';
      storage.updateIntegrations({ gemini: integrations.gemini });
    }
    return {
      replyText: '',
      shouldHandover: true,
      error: `Erro na execução do modelo Gemini: ${msg}`
    };
  }
}

export async function runProspectorAudit(params: {
  companyName: string;
  segment: string;
  city: string;
  state: string;
  websiteUrl?: string;
}): Promise<{ audit: TechnicalAudit; pitchDraft?: string; aiInsights?: string; geminiUsed: boolean; warning?: string }> {
  // Always perform real technical HTTP check first (never fabricate technical measurements)
  const realAudit = await performRealWebsiteCheck(params.websiteUrl);

  const prospectorConfig = storage.getAIAgents().find((a) => a.id === 'prospector');
  const integrations = storage.getIntegrations();
  const client = getAIClient();

  if (!client) {
    return {
      audit: realAudit,
      geminiUsed: false,
      warning: 'Verificação técnica HTTP concluída. Gemini IA não está configurado (Settings > Secrets) para redigir pitch automático.'
    };
  }

  if (!integrations.gemini.enabled) {
    return {
      audit: realAudit,
      geminiUsed: false,
      warning: 'Verificação técnica HTTP concluída. API Gemini está desativada em Configurações.'
    };
  }

  if (integrations.gemini.requestsToday >= integrations.gemini.quotaLimit) {
    storage.updateIntegrations({
      gemini: { ...integrations.gemini, status: 'limite_atingido' }
    });
    return {
      audit: realAudit,
      geminiUsed: false,
      warning: `Verificação técnica HTTP concluída. Limite diário do Gemini atingido (${integrations.gemini.requestsToday}/${integrations.gemini.quotaLimit}).`
    };
  }

  try {
    const prompt = `Você é o ${prospectorConfig?.name || 'Prospector IA FMWS'} da agência Fazer Meu Website.
Com base EXCLUSIVAMENTE nos dados técnicos reais medidos abaixo, redija um diagnóstico comercial e uma sugestão de mensagem de primeiro contato:

Empresa: ${params.companyName}
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

Retorne JSON estrito:
{
  "pitchDraft": "Mensagem respeitosa e curta para WhatsApp citando apenas fatos reais observados",
  "aiInsights": "Resumo estratégico objetivo para o vendedor humano"
}`;

    const response = await client.models.generateContent({
      model: prospectorConfig?.model || integrations.gemini.model || 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    if (prospectorConfig) {
      prospectorConfig.stats.interactionsToday += 1;
      prospectorConfig.stats.leadsHandled += 1;
      prospectorConfig.status = 'ativo';
      storage.updateAIAgent(prospectorConfig);
    }
    integrations.gemini.requestsToday += 1;
    integrations.gemini.status = 'conectado';
    storage.updateIntegrations(integrations);

    const parsed = JSON.parse(response.text || '{}');
    return {
      audit: realAudit,
      pitchDraft: parsed.pitchDraft || '',
      aiInsights: parsed.aiInsights || '',
      geminiUsed: true
    };
  } catch (err: any) {
    console.error('Error invoking Gemini for Prospector IA:', err);
    return {
      audit: realAudit,
      geminiUsed: false,
      warning: `Auditoria técnica HTTP concluída, mas a redação por Gemini falhou: ${err.message}`
    };
  }
}
