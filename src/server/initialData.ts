import {
  Lead,
  Client,
  WhatsAppConversation,
  Proposal,
  Project,
  FinancialTransaction,
  SupportTicket,
  AIAgentConfig,
  SystemIntegrations,
  ServiceProduct,
  User,
  KanbanStageConfig
} from '../types';

export interface StoredUser extends User {
  passwordHash?: string;
}

export const initialUsers: StoredUser[] = [
  {
    id: 'usr_admin',
    name: 'Nicolas Admin',
    email: 'admin@fazermeuwebsite.com.br',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    active: true,
    hasPassword: false,
    createdAt: new Date().toISOString()
  }
];

// Clean initial services table (no demo plans/prices)
export const initialServices: ServiceProduct[] = [];

// Default customizable Kanban stages
export const defaultCrmStages: KanbanStageConfig[] = [
  { id: 'novo', label: 'Novos Leads', color: 'slate', order: 0 },
  { id: 'qualificacao', label: 'Qualificação', color: 'blue', order: 1 },
  { id: 'apresentacao', label: 'Apresentação', color: 'indigo', order: 2 },
  { id: 'proposta', label: 'Proposta Enviada', color: 'gold', order: 3 },
  { id: 'negociacao', label: 'Negociação', color: 'amber', order: 4 },
  { id: 'ganho', label: 'Fechado / Ganho', color: 'emerald', order: 5 }
];

export const defaultProjectStages: KanbanStageConfig[] = [
  { id: 'briefing', label: '1. Briefing & Escopo', color: 'slate', order: 0 },
  { id: 'design_figma', label: '2. Protótipo Figma', color: 'blue', order: 1 },
  { id: 'desenvolvimento', label: '3. Codificação Web', color: 'gold', order: 2 },
  { id: 'revisao_cliente', label: '4. Revisão do Cliente', color: 'purple', order: 3 },
  { id: 'publicacao', label: '5. Lançamento / Go-Live', color: 'emerald', order: 4 }
];

// ZERO fictitious records - clean initial state for production
export const initialLeads: Lead[] = [];
export const initialClients: Client[] = [];
export const initialWhatsAppConversations: WhatsAppConversation[] = [];
export const initialProposals: Proposal[] = [];
export const initialProjects: Project[] = [];
export const initialFinancialTransactions: FinancialTransaction[] = [];
export const initialSupportTickets: SupportTicket[] = [];

export const initialAIAgents: AIAgentConfig[] = [
  {
    id: 'atendente',
    name: 'Atendente IA FMWS',
    role: 'Atendente Virtual WhatsApp & Qualificador de Oportunidades',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    status: 'nao_configurado',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    fallbackEnabled: false,
    fallbackProvider: 'deepseek',
    fallbackModel: 'deepseek-flash',
    personality: 'Cordial, consultivo, focado em entender as dores digitais da empresa do cliente e demonstrar autoridade técnica da Fazer Meu Website.',
    instructions: `Você é a Atendente IA oficial da Fazer Meu Website (FMWS SALES AI).
Suas atribuições:
1. Responder prontamente e com cordialidade clientes que entram em contato pelo WhatsApp.
2. Identificar a necessidade: novo site, loja virtual, reformulação de site antigo ou hospedagem/manutenção.
3. Consultar a tabela de preços oficial de serviços.
4. Qualificar o lead fazendo perguntas objetivas: segmento, se já tem domínio ou logotipo, prazo desejado.
5. Quando o cliente pedir orçamento formal ou se demonstrar pronto para fechar negócio, oferecer envio de proposta e transferir para atendimento humano.
6. Se o cliente for cliente ativo com dúvida técnica, registrar o chamado e avisar que o time de suporte responderá em minutos.
7. Mantenha mensagens curtas e naturais, adequadas ao WhatsApp.`,
    rules: [
      'Respostas objetivas (máximo 2 a 3 parágrafos)',
      'Nunca prometer entregas antes de 10 dias úteis',
      'Transferir imediatamente para humano se o cliente solicitar',
      'Pedir nome e empresa caso o contato não tenha se identificado'
    ],
    requiresApprovalForOutreach: false,
    autoReplyThreshold: 85,
    stats: {
      interactionsToday: 0,
      leadsHandled: 0,
      tasksCompleted: 0,
      accuracyScore: 0
    },
    diagnostics: {
      errorCounts: {}
    }
  },
  {
    id: 'prospector',
    name: 'Prospector IA FMWS',
    role: 'Inteligência de Mercado & Caçador de Oportunidades Comerciais',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    status: 'nao_configurado',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    fallbackEnabled: false,
    fallbackProvider: 'deepseek',
    fallbackModel: 'deepseek-flash',
    personality: 'Analítico, cirúrgico, focado em dados técnicos objetivos e argumentos comerciais sobre presença digital.',
    instructions: `Você é o Prospector IA oficial da Fazer Meu Website.
Suas atribuições:
1. Analisar empresas encontradas em buscas de radar (clínicas, escritórios, comércios locais, indústrias).
2. Avaliar presença digital com base em critérios técnicos reais:
   - Se a empresa NÃO tem site ou possui apenas rede social.
   - Se o site não tem certificado SSL ativo (HTTPS).
   - Se o layout não é responsivo para dispositivos móveis.
   - Se apresenta lentidão de carregamento.
3. Produzir diagnóstico resumido de pontos de melhoria e recomendar o plano ideal da FMWS.
4. Elaborar mensagem de primeiro contato personalizada e respeitosa.
5. GUARD-RAIL OBRIGATÓRIO: NUNCA disparar mensagem de abordagem fria automaticamente. Todas as abordagens devem ser salvas como 'pendente_aprovacao' no painel para que o gestor revise e aprove antes do envio.`,
    rules: [
      'Exigir aprovação humana antes de qualquer disparo ativo de prospecção',
      'Validar deduplicação antes de criar novo lead no CRM',
      'Priorizar empresas sem site ou com erro crítico de SSL',
      'Respeitar estritamente a LGPD e boas práticas comerciais'
    ],
    requiresApprovalForOutreach: true,
    autoReplyThreshold: 90,
    stats: {
      interactionsToday: 0,
      leadsHandled: 0,
      tasksCompleted: 0,
      accuracyScore: 0
    },
    diagnostics: {
      errorCounts: {}
    }
  }
];

const hasValidGeminiKey =
  typeof process !== 'undefined' &&
  process.env?.GEMINI_API_KEY &&
  process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';

const hasValidDeepSeekKey =
  typeof process !== 'undefined' &&
  process.env?.DEEPSEEK_API_KEY &&
  process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY' &&
  process.env.DEEPSEEK_API_KEY.trim().length > 5;

const envDeepSeekBaseUrl =
  typeof process !== 'undefined' && process.env?.DEEPSEEK_BASE_URL
    ? process.env.DEEPSEEK_BASE_URL.trim()
    : 'https://api.deepseek.com';

export const initialIntegrations: SystemIntegrations = {
  metaCloud: {
    enabled: false,
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    webhookVerifyToken: '',
    appSecret: '',
    bridgeSecret: '',
    webhookUrl: 'https://crm.fazermeuwebsite.com.br/api/webhooks/whatsapp.php',
    inboundVerified: false,
    aiAutoReplyOnInbound: false,
    status: 'nao_configurado'
  },
  googlePlaces: {
    enabled: false,
    apiKey: '',
    status: 'nao_configurado'
  },
  asaas: {
    enabled: false,
    apiKey: '',
    environment: 'sandbox',
    webhookSecret: '',
    status: 'nao_configurado'
  },
  gemini: {
    enabled: Boolean(hasValidGeminiKey),
    model: 'gemini-4-hydrogen',
    requestsToday: 0,
    quotaLimit: 1500,
    availableModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
    status: hasValidGeminiKey ? 'conectado' : 'nao_configurado'
  },
  deepseek: {
    enabled: Boolean(hasValidDeepSeekKey),
    baseUrl: envDeepSeekBaseUrl || 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: '',
    requestsToday: 0,
    quotaLimit: 1500,
    timeoutMs: 25000,
    maxTokens: 1200,
    tokensUsedToday: 0,
    availableModels: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    usageHistory: [],
    status: hasValidDeepSeekKey ? 'conectado' : 'nao_configurado'
  }
};
