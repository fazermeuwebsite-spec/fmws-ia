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
  KanbanStageConfig,
  ProspectCompany,
  WhatsAppIntegrationLog
} from '../types';

const SESSION_TOKEN_STORAGE_KEY = 'fmws_session_token';
let inMemorySessionToken: string | null = null;

export function getStoredSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
      if (saved) {
        inMemorySessionToken = saved;
        return saved;
      }
    }
  } catch {
    // ignore storage access issues inside restricted iframes
  }
  return null;
}

function setStoredSessionToken(token: string | null) {
  inMemorySessionToken = token;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage access issues
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg = data?.error || data?.message || `Erro HTTP ${res.status}`;
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      !url.startsWith('/api/auth/login') &&
      !url.startsWith('/api/auth/setup-admin') &&
      !url.startsWith('/api/auth/google') &&
      !url.startsWith('/api/auth/change-password') &&
      !url.startsWith('/api/auth/session')
    ) {
      setStoredSessionToken(null);
      window.dispatchEvent(
        new CustomEvent('fmws-auth-expired', {
          detail: { message: errMsg, code: data?.code }
        })
      );
    }
    const err = new Error(errMsg) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }

  return data as T;
}

export const api = {
  // Auth
  async getSession(): Promise<{
    authenticated: boolean;
    needsAdminSetup: boolean;
    token?: string;
    user: User | null;
    permissions: string[];
  }> {
    const data = await request<{
      authenticated: boolean;
      needsAdminSetup: boolean;
      token?: string;
      user: User | null;
      permissions: string[];
    }>('/api/auth/session', { cache: 'no-store' });
    if (data.authenticated && data.token) {
      setStoredSessionToken(data.token);
    } else if (!data.authenticated) {
      setStoredSessionToken(null);
    }
    return data;
  },
  async setupAdmin(payload: { name: string; email: string; password: string }): Promise<{
    success: boolean;
    token?: string;
    user: User;
    permissions: string[];
  }> {
    const data = await request<{
      success: boolean;
      token?: string;
      user: User;
      permissions: string[];
    }>('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data.token) setStoredSessionToken(data.token);
    return data;
  },
  async setupAdminWithGoogle(idToken: string): Promise<{
    success: boolean;
    token?: string;
    user: User;
    permissions: string[];
  }> {
    const data = await request<{
      success: boolean;
      token?: string;
      user: User;
      permissions: string[];
    }>('/api/auth/setup-admin-google', {
      method: 'POST',
      body: JSON.stringify({ idToken })
    });
    if (data.token) setStoredSessionToken(data.token);
    return data;
  },
  async login(email: string, password: string): Promise<{
    success: boolean;
    token?: string;
    user: User;
    permissions: string[];
  }> {
    const data = await request<{
      success: boolean;
      token?: string;
      user: User;
      permissions: string[];
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.token) setStoredSessionToken(data.token);
    return data;
  },
  async loginWithGoogle(idToken: string): Promise<{
    success: boolean;
    token?: string;
    user: User;
    permissions: string[];
  }> {
    const data = await request<{
      success: boolean;
      token?: string;
      user: User;
      permissions: string[];
    }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken })
    });
    if (data.token) setStoredSessionToken(data.token);
    return data;
  },
  async linkGoogleAccount(idToken: string): Promise<{
    success: boolean;
    user: User;
  }> {
    return request('/api/auth/link-google', {
      method: 'POST',
      body: JSON.stringify({ idToken })
    });
  },
  async logout(): Promise<{ success: boolean }> {
    try {
      return await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredSessionToken(null);
    }
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  // Users (Admin)
  async getUsers(): Promise<User[]> {
    return request('/api/users');
  },
  async createUser(payload: {
    name: string;
    email: string;
    password: string;
    role: User['role'];
    active?: boolean;
  }): Promise<User> {
    return request('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async updateUser(id: string, payload: Partial<User> & { password?: string }): Promise<User> {
    return request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },
  async deleteUser(id: string): Promise<{ success: boolean }> {
    return request(`/api/users/${id}`, { method: 'DELETE' });
  },

  // Dashboard
  async getDashboardMetrics(): Promise<any> {
    return request('/api/dashboard/metrics');
  },

  // Kanban Stages
  async getKanbanStages(): Promise<{ crmStages: KanbanStageConfig[]; projectStages: KanbanStageConfig[] }> {
    return request('/api/kanban/stages');
  },
  async saveCrmStages(stages: KanbanStageConfig[]): Promise<KanbanStageConfig[]> {
    return request('/api/kanban/stages/crm', {
      method: 'PUT',
      body: JSON.stringify({ stages })
    });
  },
  async saveProjectStages(stages: KanbanStageConfig[]): Promise<KanbanStageConfig[]> {
    return request('/api/kanban/stages/projects', {
      method: 'PUT',
      body: JSON.stringify({ stages })
    });
  },

  // Leads
  async getLeads(): Promise<Lead[]> {
    return request('/api/leads');
  },
  async createLead(lead: Partial<Lead>): Promise<Lead> {
    return request('/api/leads', {
      method: 'POST',
      body: JSON.stringify(lead)
    });
  },
  async updateLead(id: string, lead: Partial<Lead>): Promise<Lead> {
    return request(`/api/leads/${id}`, {
      method: 'PUT',
      body: JSON.stringify(lead)
    });
  },
  async deleteLead(id: string): Promise<{ success: boolean }> {
    return request(`/api/leads/${id}`, { method: 'DELETE' });
  },
  async importLeads(leads: Partial<Lead>[]): Promise<{ imported: number; duplicates: number }> {
    return request('/api/leads/import', {
      method: 'POST',
      body: JSON.stringify({ leads })
    });
  },
  async approveOutreach(leadId: string, pitchText: string, userName: string): Promise<any> {
    return request(`/api/leads/${leadId}/approve-outreach`, {
      method: 'POST',
      body: JSON.stringify({ pitchText, userName })
    });
  },

  // Prospecting
  async getProspects(): Promise<ProspectCompany[]> {
    return request('/api/prospects');
  },
  async createProspect(payload: Partial<ProspectCompany>): Promise<ProspectCompany> {
    return request('/api/prospects', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async importProspectsCsv(rows: any[]): Promise<{ imported: number; duplicates: number; prospects: ProspectCompany[] }> {
    return request('/api/prospects/import-csv', {
      method: 'POST',
      body: JSON.stringify({ rows })
    });
  },
  async auditProspect(id: string, websiteUrl?: string): Promise<{ prospect: ProspectCompany; geminiUsed: boolean; warning?: string }> {
    return request(`/api/prospects/${id}/audit`, {
      method: 'POST',
      body: JSON.stringify({ websiteUrl })
    });
  },
  async deleteProspect(id: string): Promise<{ success: boolean }> {
    return request(`/api/prospects/${id}`, { method: 'DELETE' });
  },
  async searchProspects(params: { state: string; city: string; segment: string; radius: number }): Promise<any> {
    return request('/api/prospecting/search', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },
  async auditCompany(data: { companyName: string; segment: string; city: string; state: string; websiteUrl?: string }): Promise<any> {
    return request('/api/prospecting/audit-company', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Clients
  async getClients(): Promise<Client[]> {
    return request('/api/clients');
  },
  async createClient(client: Partial<Client>): Promise<Client> {
    return request('/api/clients', {
      method: 'POST',
      body: JSON.stringify(client)
    });
  },
  async updateClient(id: string, client: Partial<Client>): Promise<Client> {
    return request(`/api/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(client)
    });
  },
  async deleteClient(id: string): Promise<{ success: boolean }> {
    return request(`/api/clients/${id}`, { method: 'DELETE' });
  },

  // Proposals
  async getProposals(): Promise<Proposal[]> {
    return request('/api/proposals');
  },
  async createProposal(proposal: Partial<Proposal>): Promise<Proposal> {
    return request('/api/proposals', {
      method: 'POST',
      body: JSON.stringify(proposal)
    });
  },
  async updateProposal(id: string, proposal: Partial<Proposal>): Promise<Proposal> {
    return request(`/api/proposals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(proposal)
    });
  },
  async approveProposal(id: string, approverName: string): Promise<any> {
    return request(`/api/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approverName })
    });
  },
  async deleteProposal(id: string): Promise<{ success: boolean }> {
    return request(`/api/proposals/${id}`, { method: 'DELETE' });
  },

  // Projects
  async getProjects(): Promise<Project[]> {
    return request('/api/projects');
  },
  async createProject(project: Partial<Project>): Promise<Project> {
    return request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(project)
    });
  },
  async updateProject(id: string, project: Partial<Project> & { historyAction?: string }): Promise<Project> {
    return request(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(project)
    });
  },
  async deleteProject(id: string): Promise<{ success: boolean }> {
    return request(`/api/projects/${id}`, { method: 'DELETE' });
  },

  // Financial
  async getFinancial(): Promise<FinancialTransaction[]> {
    return request('/api/financial');
  },
  async createFinancial(tx: Partial<FinancialTransaction>): Promise<FinancialTransaction> {
    return request('/api/financial', {
      method: 'POST',
      body: JSON.stringify(tx)
    });
  },
  async updateFinancial(id: string, tx: Partial<FinancialTransaction>): Promise<FinancialTransaction> {
    return request(`/api/financial/${id}`, {
      method: 'PUT',
      body: JSON.stringify(tx)
    });
  },
  async deleteFinancial(id: string): Promise<{ success: boolean }> {
    return request(`/api/financial/${id}`, { method: 'DELETE' });
  },

  // Support
  async getSupportTickets(): Promise<SupportTicket[]> {
    return request('/api/support');
  },
  async createSupportTicket(ticket: Partial<SupportTicket>): Promise<SupportTicket> {
    return request('/api/support', {
      method: 'POST',
      body: JSON.stringify(ticket)
    });
  },
  async updateSupportTicket(id: string, ticket: Partial<SupportTicket>): Promise<SupportTicket> {
    return request(`/api/support/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ticket)
    });
  },

  // WhatsApp
  async getWhatsAppConversations(): Promise<WhatsAppConversation[]> {
    return request('/api/whatsapp/conversations');
  },
  async createWhatsAppConversation(payload: {
    phone: string;
    contactName?: string;
    leadId?: string;
    clientId?: string;
    phoneNumberId?: string;
    workspaceId?: string;
  }): Promise<WhatsAppConversation> {
    return request('/api/whatsapp/conversations', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async sendWhatsAppMessage(
    conversationId: string,
    text: string,
    senderName?: string,
    fallbackMeta?: {
      contactPhone?: string;
      contactName?: string;
      phoneNumberId?: string;
      workspaceId?: string;
    }
  ): Promise<any> {
    return request('/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        conversationId,
        text,
        senderName,
        ...(fallbackMeta?.contactPhone ? { contactPhone: fallbackMeta.contactPhone } : {}),
        ...(fallbackMeta?.contactName ? { contactName: fallbackMeta.contactName } : {}),
        ...(fallbackMeta?.phoneNumberId ? { phoneNumberId: fallbackMeta.phoneNumberId } : {}),
        ...(fallbackMeta?.workspaceId ? { workspaceId: fallbackMeta.workspaceId } : {})
      })
    });
  },
  async hydrateWhatsAppFromFirestore(payload: {
    conversations?: WhatsAppConversation[];
    activeConversationId?: string;
    messages?: WhatsAppConversation['messages'];
    handovers?: WhatsAppConversation['handoverHistory'];
    logs?: WhatsAppIntegrationLog[];
  }): Promise<{ ok: boolean; count: number }> {
    return request('/api/whatsapp/firestore-hydrate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async mergeWhatsAppDuplicatesLocal(
    mergedConversation: WhatsAppConversation,
    removedIds: string[]
  ): Promise<{ ok: boolean; count: number; conversation: WhatsAppConversation }> {
    return request('/api/whatsapp/merge-duplicates', {
      method: 'POST',
      body: JSON.stringify({ mergedConversation, removedIds })
    });
  },
  async getWhatsAppTemplates(): Promise<{
    templates: Array<{ name: string; status: string; language: string; category: string; bodyText?: string }>;
  }> {
    return request('/api/whatsapp/templates');
  },
  async sendWhatsAppTemplate(payload: {
    conversationId: string;
    templateName: string;
    languageCode?: string;
    bodyParams?: string[];
    previewText?: string;
    phoneNumberId?: string;
    workspaceId?: string;
  }): Promise<any> {
    return request('/api/whatsapp/send-template', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async simulateIncomingWhatsApp(conversationId: string, text: string): Promise<any> {
    return request('/api/whatsapp/simulate-incoming', {
      method: 'POST',
      body: JSON.stringify({ conversationId, text })
    });
  },
  async setWhatsAppHandover(
    conversationId: string,
    payload:
      | {
          status?: 'ai_active' | 'human_takeover' | 'resolved';
          assignedAgent?: string;
          assignedUserId?: string;
          aiPaused?: boolean;
          note?: string;
        }
      | 'ai_active'
      | 'human_takeover'
      | 'resolved',
    legacyAssignedAgent?: string
  ): Promise<WhatsAppConversation> {
    const body =
      typeof payload === 'string'
        ? { status: payload, assignedAgent: legacyAssignedAgent }
        : payload;
    return request(`/api/whatsapp/conversations/${conversationId}/handover`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },
  async getWhatsAppAttendants(): Promise<Array<{ id: string; name: string; role: string }>> {
    return request('/api/whatsapp/attendants');
  },
  async linkWhatsAppConversation(
    conversationId: string,
    payload: { leadId?: string; clientId?: string; contactName?: string }
  ): Promise<WhatsAppConversation> {
    return request(`/api/whatsapp/conversations/${conversationId}/link`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },
  async createLeadFromWhatsApp(
    conversationId: string,
    payload?: { name?: string; company?: string; email?: string; segment?: string }
  ): Promise<{ lead: Lead; conversation: WhatsAppConversation; alreadyLinked?: boolean }> {
    return request(`/api/whatsapp/conversations/${conversationId}/create-lead`, {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  },
  async markWhatsAppConversationRead(conversationId: string): Promise<WhatsAppConversation> {
    return request(`/api/whatsapp/conversations/${conversationId}/read`, {
      method: 'PUT'
    });
  },
  async deleteWhatsAppConversation(conversationId: string): Promise<{ success: boolean }> {
    return request(`/api/whatsapp/conversations/${conversationId}`, {
      method: 'DELETE'
    });
  },

  // AI Agents
  async getAIAgents(): Promise<AIAgentConfig[]> {
    return request('/api/agents');
  },
  async updateAIAgent(id: string, agent: Partial<AIAgentConfig>): Promise<AIAgentConfig> {
    return request(`/api/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(agent)
    });
  },
  async testAIAgent(id: 'atendente' | 'prospector'): Promise<{
    ok: boolean;
    agent: AIAgentConfig;
    integrations: SystemIntegrations;
    providerUsed?: 'gemini' | 'deepseek';
    modelUsed?: string;
    fallbackUsed?: boolean;
    message?: string;
    error?: string;
    diagnostics?: {
      provider?: 'gemini' | 'deepseek';
      model?: string;
      gemini: string;
      deepseek?: string;
      latencyMs?: number;
      httpStatus?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      metaCloud: string;
      googlePlaces: string;
    };
  }> {
    return request(`/api/agents/${id}/test`, { method: 'POST' });
  },
  async simulateAtendenteAI(payload: {
    contactName?: string;
    message: string;
    chatHistory?: Array<{ sender: string; text: string }>;
  }): Promise<{
    replyText: string;
    shouldHandover: boolean;
    suggestedLeadStatus?: string;
    providerUsed?: 'gemini' | 'deepseek';
    modelUsed?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
    totalTokens?: number;
    error?: string;
    agent?: AIAgentConfig;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/agents/atendente/simulate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async testProspectorAudit(payload: {
    companyName: string;
    segment?: string;
    city?: string;
    state?: string;
    websiteUrl?: string;
  }): Promise<{
    audit: any;
    pitchDraft?: string;
    aiInsights?: string;
    geminiUsed: boolean;
    aiUsed?: boolean;
    providerUsed?: 'gemini' | 'deepseek';
    modelUsed?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
    totalTokens?: number;
    warning?: string;
    agent?: AIAgentConfig;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/agents/prospector/test-audit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Integrations & Services
  async getIntegrations(): Promise<SystemIntegrations> {
    return request('/api/integrations');
  },
  async updateIntegrations(data: Partial<SystemIntegrations>): Promise<SystemIntegrations> {
    return request('/api/integrations', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },
  async testGooglePlaces(apiKey?: string): Promise<{
    valid: boolean;
    status: string;
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/test-google-places', {
      method: 'POST',
      body: JSON.stringify({ apiKey: apiKey || '' })
    });
  },
  async testGemini(model?: string): Promise<{
    valid: boolean;
    status: string;
    model?: string;
    latencyMs?: number;
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/test-gemini', {
      method: 'POST',
      body: JSON.stringify({ model: model || '' })
    });
  },
  async testDeepSeek(payload?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    maxTokens?: number;
    quotaLimit?: number;
    enabled?: boolean;
    saveCredentials?: boolean;
  }): Promise<{
    valid: boolean;
    status: string;
    model?: string;
    baseUrl?: string;
    httpStatus?: number;
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    models?: string[];
    modelsSource?: 'live_api' | 'fallback';
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/test-deepseek', {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  },
  async fetchDeepSeekModels(payload?: {
    apiKey?: string;
    baseUrl?: string;
  }): Promise<{
    ok: boolean;
    source: 'live_api' | 'fallback';
    models: string[];
    liveModels: string[];
    httpStatus?: number;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    if (payload && (payload.apiKey || payload.baseUrl)) {
      return request('/api/integrations/deepseek/models', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    return request('/api/integrations/deepseek/models');
  },
  async fetchGeminiModels(): Promise<{ ok: boolean; models: string[] }> {
    return request('/api/integrations/gemini/models');
  },
  async testMetaConnection(payload?: {
    enabled?: boolean;
    phoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
    verifyToken?: string;
    appSecret?: string;
  }): Promise<{
    valid: boolean;
    status?: string;
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
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/test-meta-connection', {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  },
  async verifyPhpWebhook(payload?: { verifyToken?: string }): Promise<{
    valid: boolean;
    webhookUrl: string;
    httpStatus?: number;
    challengeMatched: boolean;
    bodyPreview?: string;
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/verify-php-webhook', {
      method: 'POST',
      body: JSON.stringify(payload || {})
    });
  },
  async generateBridgeSecret(): Promise<{
    bridgeSecret: string;
    integrations: SystemIntegrations;
  }> {
    return request('/api/integrations/generate-bridge-secret', { method: 'POST' });
  },
  async getWhatsAppLogs(): Promise<{ logs: WhatsAppIntegrationLog[] }> {
    return request('/api/integrations/whatsapp-logs');
  },
  async testMetaWebhook(payload: {
    webhookUrl?: string;
    verifyToken?: string;
    phoneNumberId?: string;
    wabaId?: string;
    enabled?: boolean;
  }): Promise<{
    valid: boolean;
    localOk?: boolean;
    externalOk?: boolean;
    requiresDeploy?: boolean;
    blockedByDevProxy?: boolean;
    notPublishedYet?: boolean;
    statusCode?: number;
    message?: string;
    error?: string;
    integrations?: SystemIntegrations;
  }> {
    return request('/api/integrations/test-meta-webhook', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async getMetaDiagnostics(): Promise<{
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
    enabled: boolean;
    hasVerifyToken: boolean;
    webhookUrl?: string;
    appUrl: string;
    recentWebhookLogs: Array<{ id: string; timestamp: string; kind: string; summary: string }>;
    whatsappLogs?: WhatsAppIntegrationLog[];
  }> {
    return request('/api/integrations/meta-diagnostics');
  },
  async subscribeMetaWaba(): Promise<{ success: boolean }> {
    return request('/api/integrations/subscribe-waba', { method: 'POST' });
  },
  async getServices(): Promise<ServiceProduct[]> {
    return request('/api/services');
  },
  async saveService(service: Partial<ServiceProduct>): Promise<ServiceProduct> {
    if (service.id) {
      return request(`/api/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify(service)
      });
    }
    return request('/api/services', {
      method: 'POST',
      body: JSON.stringify(service)
    });
  },
  async deleteService(id: string): Promise<{ success: boolean }> {
    return request(`/api/services/${id}`, { method: 'DELETE' });
  },

  // Firestore Cloud Sync
  async exportCloudSnapshot(): Promise<{
    users: any[];
    buckets: Record<string, any[]>;
    deletedWhatsAppIds?: Array<{ id: string; deletedAt: string }>;
  }> {
    return request('/api/cloud/export');
  },
  async restoreCloudSnapshot(
    buckets: Record<string, any[]>,
    users?: any[],
    options?: { onlyFillMissing?: boolean }
  ): Promise<{ success: boolean; restoredAt: string }> {
    return request('/api/cloud/restore', {
      method: 'POST',
      body: JSON.stringify({ buckets, users, onlyFillMissing: Boolean(options?.onlyFillMissing) })
    });
  }
};
