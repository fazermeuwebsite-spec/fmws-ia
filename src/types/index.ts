export type UserRole = 'admin' | 'comercial' | 'suporte' | 'financeiro';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  active: boolean;
  hasPassword?: boolean;
  linkedGoogleEmail?: string;
  createdAt?: string;
}

export type KanbanColor =
  | 'slate'
  | 'blue'
  | 'indigo'
  | 'gold'
  | 'amber'
  | 'emerald'
  | 'rose'
  | 'purple';

export interface KanbanStageConfig {
  id: string;
  label: string;
  color: KanbanColor;
  order: number;
}

export interface HistoryEntry {
  id: string;
  action: string;
  fromStage?: string;
  toStage?: string;
  user: string;
  date: string;
}

export type LeadStatus =
  | 'novo'
  | 'qualificacao'
  | 'apresentacao'
  | 'proposta'
  | 'negociacao'
  | 'ganho'
  | 'perdido'
  | (string & {});

export type PriorityLevel = 'baixa' | 'media' | 'alta' | 'urgente';

export interface TechnicalAudit {
  score: number; // 0 to 100
  hasWebsite: boolean;
  ssl: boolean;
  mobileReady: boolean;
  speedScore: number;
  domainAvailable?: boolean;
  issues: string[];
  recommendedService: string;
  checkedAt?: string;
  httpStatus?: number;
  responseTimeMs?: number;
  pageTitle?: string;
  error?: string;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  whatsapp: string;
  segment: string;
  city: string;
  state: string;
  address?: string;
  websiteUrl?: string;
  technicalAudit: TechnicalAudit;
  source: 'prospeccao' | 'whatsapp' | 'manual' | 'site' | 'csv';
  status: LeadStatus;
  priority: PriorityLevel;
  value: number;
  tags: string[];
  assignedTo: string;
  notes: Array<{
    id: string;
    author: string;
    text: string;
    createdAt: string;
  }>;
  history?: HistoryEntry[];
  aiInsights?: string;
  campaignStatus?: 'pendente_aprovacao' | 'aprovado' | 'enviado' | 'respondido';
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
}

export interface ProspectCompany {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  whatsapp: string;
  segment: string;
  city: string;
  state: string;
  address: string;
  websiteUrl: string;
  source: 'manual' | 'csv' | 'google_places';
  technicalAudit: TechnicalAudit;
  pitchDraft?: string;
  aiInsights?: string;
  importedToCrm?: boolean;
  createdAt: string;
}

export interface ClientService {
  id: string;
  name: string;
  type: 'website' | 'hospedagem' | 'manutencao' | 'dominio' | 'ecommerce';
  domain?: string;
  hostingServer?: string;
  expiryDate: string;
  monthlyValue: number;
  status: 'ativo' | 'renovacao' | 'suspenso';
  catalogServiceId?: string;
  billingCycle?: 'mensal' | 'anual' | 'unico';
}

export interface Client {
  id: string;
  leadId?: string;
  companyName: string;
  tradeName: string;
  cnpjCpf: string;
  contactName: string;
  email: string;
  phone: string;
  whatsapp: string;
  city: string;
  state: string;
  address: string;
  status: 'ativo' | 'inadimplente' | 'cancelado';
  contractStart: string;
  mrr: number; // Monthly Recurring Revenue
  services: ClientService[];
  notes: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sender: 'contact' | 'agent' | 'system';
  direction?: 'inbound' | 'outbound' | 'system';
  senderName?: string;
  text: string;
  timestamp: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  metaMessageId?: string;
  phoneNumberId?: string;
  waId?: string;
  errorMessage?: string;
  aiGenerated?: boolean;
}

export interface WhatsAppHandoverEntry {
  id: string;
  action:
    | 'created'
    | 'assumed_human'
    | 'returned_to_ai'
    | 'ai_paused'
    | 'ai_resumed'
    | 'transferred'
    | 'resolved'
    | 'reopened'
    | 'linked'
    | 'merged_duplicate';
  fromStatus?: string;
  toStatus: string;
  assignedTo?: string;
  byUser: string;
  note?: string;
  at: string;
}

export interface WhatsAppIntegrationLog {
  id: string;
  timestamp: string;
  source: 'php_bridge' | 'php_webhook' | 'meta_direct' | 'outbound' | 'ai' | 'security' | 'verify' | 'handover';
  level: 'info' | 'warning' | 'error';
  eventType: string;
  conversationId?: string;
  phoneNumberId?: string;
  wamid?: string;
  summary: string;
  httpStatus?: number;
}

export interface WhatsAppConversation {
  id: string;
  contactPhone: string;
  waId?: string;
  phoneNumberId?: string;
  conversationKey?: string;
  contactName: string;
  leadId?: string;
  clientId?: string;
  channel: 'meta_cloud';
  status: 'ai_active' | 'human_takeover' | 'resolved';
  aiPaused?: boolean;
  lastMessage: string;
  lastMessageTimestamp: string;
  lastInboundAt?: string;
  unreadCount: number;
  assignedAgent: string;
  assignedUserId?: string;
  closedAt?: string;
  closedBy?: string;
  handoverHistory?: WhatsAppHandoverEntry[];
  tags: string[];
  messages: ChatMessage[];
}

export interface ProposalItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Proposal {
  id: string;
  code: string;
  clientName: string;
  leadId?: string;
  clientId?: string;
  title: string;
  summary: string;
  items: ProposalItem[];
  totalValue: number;
  paymentTerms: string;
  deliveryDays: number;
  validUntil: string;
  status: 'rascunho' | 'aguardando_aprovacao' | 'aprovada' | 'enviada' | 'aceita' | 'recusada';
  createdBy: string;
  approvedBy?: string;
  version: number;
  createdAt: string;
  history: Array<{ action: string; date: string; user: string }>;
}

export interface ProjectTask {
  id: string;
  title: string;
  done: boolean;
  assignee: string;
  deadline?: string;
}

export type ProjectStage =
  | 'briefing'
  | 'design_figma'
  | 'desenvolvimento'
  | 'revisao_cliente'
  | 'publicacao'
  | (string & {});

export interface Project {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  stage: ProjectStage;
  progress: number; // 0-100 calculated from completed tasks
  deadline: string;
  priority: PriorityLevel;
  manager: string;
  websitePreviewUrl?: string;
  tasks: ProjectTask[];
  deliverables: string[];
  budget: number;
  notes?: string;
  history?: HistoryEntry[];
  createdAt: string;
  updatedAt?: string;
}

export interface FinancialTransaction {
  id: string;
  clientId?: string;
  clientName: string;
  description: string;
  type: 'receita' | 'despesa';
  category: 'desenvolvimento' | 'hospedagem' | 'manutencao' | 'marketing' | 'infraestrutura' | 'impostos' | 'salarios';
  value: number;
  dueDate: string;
  paymentDate?: string;
  status: 'pago' | 'pendente' | 'atrasado';
  paymentMethod: 'pix' | 'boleto' | 'cartao';
  recurring: boolean;
  asaasId?: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  code: string;
  clientId?: string;
  clientName: string;
  contactPhone: string;
  subject: string;
  description: string;
  priority: 'baixa' | 'media' | 'alta' | 'critica';
  status: 'aberto' | 'em_atendimento' | 'aguardando_cliente' | 'resolvido';
  channel: 'whatsapp' | 'email' | 'painel';
  assignedTo: string;
  createdAt: string;
  resolvedAt?: string;
  notes: Array<{ author: string; text: string; createdAt: string }>;
}

export interface AIAgentConfig {
  id: 'atendente' | 'prospector';
  name: string;
  role: string;
  avatar: string;
  status: 'ativo' | 'pausado' | 'em_treinamento' | 'nao_configurado' | 'erro';
  model: string;
  personality: string;
  instructions: string;
  rules: string[];
  requiresApprovalForOutreach: boolean;
  autoReplyThreshold: number;
  stats: {
    interactionsToday: number;
    leadsHandled: number;
    tasksCompleted: number;
    accuracyScore: number;
  };
}

export interface SystemIntegrations {
  metaCloud: {
    enabled: boolean;
    phoneNumberId: string;
    wabaId: string;
    accessToken?: string;
    webhookVerifyToken?: string;
    appSecret?: string;
    bridgeSecret?: string;
    webhookUrl?: string;
    lastSyncedAt?: string;
    connectedPhoneDisplay?: string;
    connectedVerifiedName?: string;
    phpWebhookVerified?: boolean;
    inboundVerified?: boolean;
    aiAutoReplyOnInbound?: boolean;
    hasAccessToken?: boolean;
    hasWebhookVerifyToken?: boolean;
    hasAppSecret?: boolean;
    hasBridgeSecret?: boolean;
    accessTokenHint?: string;
    webhookVerifyTokenHint?: string;
    appSecretHint?: string;
    bridgeSecretHint?: string;
    status: 'conectado' | 'desconectado' | 'sandbox' | 'nao_configurado' | 'erro';
  };
  googlePlaces: {
    enabled: boolean;
    apiKey?: string;
    hasApiKey?: boolean;
    apiKeyHint?: string;
    status: 'conectado' | 'desconectado' | 'nao_configurado' | 'erro';
  };
  asaas: {
    enabled: boolean;
    apiKey?: string;
    environment: 'sandbox' | 'producao';
    webhookSecret?: string;
    hasApiKey?: boolean;
    hasWebhookSecret?: boolean;
    apiKeyHint?: string;
    status: 'conectado' | 'desconectado' | 'nao_configurado' | 'erro';
  };
  gemini: {
    enabled: boolean;
    model: string;
    requestsToday: number;
    quotaLimit: number;
    hasEnvKey?: boolean;
    status: 'conectado' | 'desconectado' | 'nao_configurado' | 'limite_atingido' | 'erro';
  };
}

export interface ServiceProduct {
  id: string;
  name: string;
  category: 'desenvolvimento' | 'recorrente' | 'infra';
  description: string;
  basePrice: number;
  isRecurring: boolean;
  billingCycle?: 'mensal' | 'anual' | 'unico';
  features: string[];
}
