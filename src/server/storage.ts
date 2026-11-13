import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SessionRecord, SESSION_TTL_MS } from './auth';
import {
  initialLeads,
  initialClients,
  initialWhatsAppConversations,
  initialProposals,
  initialProjects,
  initialFinancialTransactions,
  initialSupportTickets,
  initialAIAgents,
  initialIntegrations,
  initialServices,
  initialUsers,
  defaultCrmStages,
  defaultProjectStages,
  StoredUser
} from './initialData';
import {
  Lead,
  Client,
  ChatMessage,
  WhatsAppConversation,
  WhatsAppHandoverEntry,
  WhatsAppIntegrationLog,
  Proposal,
  Project,
  FinancialTransaction,
  SupportTicket,
  AIAgentConfig,
  SystemIntegrations,
  ServiceProduct,
  KanbanStageConfig,
  ProspectCompany
} from '../types';
import {
  OFFICIAL_PHP_WEBHOOK_URL,
  normalizePhoneForMeta,
  phonesMatch
} from './metaWhatsApp';

interface DatabaseSchema {
  leads: Lead[];
  clients: Client[];
  prospects: ProspectCompany[];
  whatsappConversations: WhatsAppConversation[];
  whatsappLogs: WhatsAppIntegrationLog[];
  proposals: Proposal[];
  projects: Project[];
  financialTransactions: FinancialTransaction[];
  supportTickets: SupportTicket[];
  aiAgents: AIAgentConfig[];
  integrations: SystemIntegrations;
  services: ServiceProduct[];
  users: StoredUser[];
  sessions: SessionRecord[];
  crmStages: KanbanStageConfig[];
  projectStages: KanbanStageConfig[];
  lastBackup?: string;
}

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const DB_TMP = path.join(DB_DIR, 'db.json.tmp');

const DEMO_SERVICE_SIGNATURES = new Map<string, string>([
  ['srv_1', 'Website Institucional Pro'],
  ['srv_2', 'Landing Page de Alta Conversão'],
  ['srv_3', 'E-commerce WooCommerce Turbo'],
  ['srv_4', 'Hospedagem Cloud SSD NVMe + SSL'],
  ['srv_5', 'Plano de Manutenção & Suporte VIP']
]);

const DEMO_USER_EMAILS = new Set<string>([
  'carlos.vendas@fazermeuwebsite.com.br',
  'marina.suporte@fazermeuwebsite.com.br',
  'financeiro@fazermeuwebsite.com.br'
]);

const DEMO_USER_NAMES = new Set<string>([
  'Carlos Oliveira',
  'Marina Santos',
  'Renata Lima'
]);

function getEnvPlacesKey(): string {
  const raw = (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!raw || raw === 'MY_GOOGLE_PLACES_API_KEY' || raw === 'MY_GOOGLE_MAPS_API_KEY') return '';
  return raw;
}

function maskSecretHint(secret?: string): string | undefined {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmed) return undefined;
  if (trimmed.length <= 6) return '••••••';
  return `••••${trimmed.slice(-4)}`;
}

function getCloudVaultKey(): Buffer {
  let seed = 'fmws-crm-vault-fallback';
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      seed = `${parsed.projectId || ''}:${parsed.firestoreDatabaseId || ''}:${parsed.appId || ''}:fmws-vault-v1`;
    }
  } catch {
    // keep fallback
  }
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptVaultPayload(payload: Record<string, string | undefined>): string | undefined {
  const nonEmpty: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' && v.trim().length > 0) {
      nonEmpty[k] = v.trim();
    }
  }
  if (Object.keys(nonEmpty).length === 0) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getCloudVaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(nonEmpty), 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptVaultPayload(token: unknown): Record<string, string> {
  if (typeof token !== 'string' || !token.includes('.')) return {};
  try {
    const [ivB64, tagB64, dataB64] = token.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return {};
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getCloudVaultKey(),
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final()
    ]).toString('utf-8');
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

class StorageManager {
  private db: DatabaseSchema;

  constructor() {
    this.ensureDirectory();
    this.db = this.loadDatabase();
  }

  private ensureDirectory() {
    if (!fs.existsSync(DB_DIR)) {
      try {
        fs.mkdirSync(DB_DIR, { recursive: true });
      } catch (err) {
        console.error('Error creating data directory:', err);
      }
    }
  }

  private loadDatabase(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
        if (parsed && typeof parsed === 'object') {
          let dirty = false;

          // Migrate services: remove only exact demo plans, preserve real user-added services
          const existingServices = Array.isArray(parsed.services) ? parsed.services : [];
          const cleanedServices = existingServices.filter((svc) => {
            const demoName = DEMO_SERVICE_SIGNATURES.get(svc.id);
            if (demoName && svc.name === demoName) {
              dirty = true;
              return false;
            }
            return true;
          });

          // Migrate users: remove only fictitious demo accounts, keep legitimate admin & real accounts
          const existingUsers = Array.isArray(parsed.users) ? parsed.users : [];
          const cleanedUsers = existingUsers.filter((u) => {
            if (u.id === 'usr_admin' || u.role === 'admin') return true;
            if (DEMO_USER_EMAILS.has(u.email) || DEMO_USER_NAMES.has(u.name)) {
              dirty = true;
              return false;
            }
            return true;
          });
          if (cleanedUsers.length === 0) {
            cleanedUsers.push(...initialUsers);
            dirty = true;
          }

          // Ensure Kanban stage configs exist
          const crmStages = Array.isArray(parsed.crmStages) && parsed.crmStages.length > 0
            ? parsed.crmStages
            : (dirty = true, defaultCrmStages);

          const projectStages = Array.isArray(parsed.projectStages) && parsed.projectStages.length > 0
            ? parsed.projectStages
            : (dirty = true, defaultProjectStages);

          const prospects = Array.isArray(parsed.prospects) ? parsed.prospects : (dirty = true, []);

          // Normalize Gemini integration status from real runtime env
          const integrations = parsed.integrations || initialIntegrations;
          const hasGeminiEnv = Boolean(
            process.env.GEMINI_API_KEY &&
            process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
            process.env.GEMINI_API_KEY.trim().length > 5
          );
          if (integrations.gemini) {
            if (!hasGeminiEnv) {
              if (integrations.gemini.enabled || integrations.gemini.status !== 'nao_configurado') {
                integrations.gemini.enabled = false;
                integrations.gemini.status = 'nao_configurado';
                dirty = true;
              }
            } else {
              const expectedStatus = integrations.gemini.enabled ? 'conectado' : 'desconectado';
              if (integrations.gemini.status === 'nao_configurado' && !integrations.gemini.enabled) {
                integrations.gemini.enabled = true;
                integrations.gemini.status = 'conectado';
                dirty = true;
              } else if (integrations.gemini.status !== expectedStatus && integrations.gemini.status !== 'limite_atingido') {
                integrations.gemini.status = expectedStatus;
                dirty = true;
              }
            }
            if (typeof integrations.gemini.model === 'string' && integrations.gemini.model.startsWith('gemini-2.')) {
              integrations.gemini.model = 'gemini-4-hydrogen';
              dirty = true;
            }
          }

          // Ensure Meta Cloud official PHP webhook URL & optional backend env fallbacks
          if (integrations.metaCloud) {
            if (integrations.metaCloud.webhookUrl !== OFFICIAL_PHP_WEBHOOK_URL) {
              integrations.metaCloud.webhookUrl = OFFICIAL_PHP_WEBHOOK_URL;
              dirty = true;
            }
            if (!integrations.metaCloud.phoneNumberId?.trim() && process.env.META_PHONE_NUMBER_ID?.trim()) {
              integrations.metaCloud.phoneNumberId = process.env.META_PHONE_NUMBER_ID.trim();
              dirty = true;
            }
            if (!integrations.metaCloud.wabaId?.trim() && process.env.META_WABA_ID?.trim()) {
              integrations.metaCloud.wabaId = process.env.META_WABA_ID.trim();
              dirty = true;
            }
            if (!integrations.metaCloud.accessToken?.trim() && process.env.META_ACCESS_TOKEN?.trim()) {
              integrations.metaCloud.accessToken = process.env.META_ACCESS_TOKEN.trim();
              dirty = true;
            }
            if (!integrations.metaCloud.webhookVerifyToken?.trim() && process.env.META_VERIFY_TOKEN?.trim()) {
              integrations.metaCloud.webhookVerifyToken = process.env.META_VERIFY_TOKEN.trim();
              dirty = true;
            }
            if (!integrations.metaCloud.appSecret?.trim() && process.env.META_APP_SECRET?.trim()) {
              integrations.metaCloud.appSecret = process.env.META_APP_SECRET.trim();
              dirty = true;
            }
            if (!integrations.metaCloud.bridgeSecret?.trim() && process.env.WHATSAPP_BRIDGE_SECRET?.trim()) {
              integrations.metaCloud.bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET.trim();
              dirty = true;
            }
          }

          // Ensure Google Places uses Secrets env fallback if unconfigured, or remains disabled
          const envPlacesKey = getEnvPlacesKey();
          if (integrations.googlePlaces && !integrations.googlePlaces.apiKey?.trim()) {
            if (envPlacesKey && integrations.googlePlaces.status === 'nao_configurado') {
              integrations.googlePlaces.apiKey = envPlacesKey;
              integrations.googlePlaces.enabled = true;
              integrations.googlePlaces.status = 'conectado';
              dirty = true;
            } else if (integrations.googlePlaces.enabled || integrations.googlePlaces.status !== 'nao_configurado') {
              integrations.googlePlaces.enabled = false;
              integrations.googlePlaces.status = 'nao_configurado';
              dirty = true;
            }
          }

          const nowMs = Date.now();
          const validSessions = Array.isArray(parsed.sessions)
            ? parsed.sessions.filter((s) => s && s.sid && s.userId && s.expiresAt > nowMs)
            : [];

          const rawAgents =
            Array.isArray(parsed.aiAgents) && parsed.aiAgents.length > 0 ? parsed.aiAgents : initialAIAgents;
          const aiAgents = rawAgents.map((agent) => {
            if (typeof agent.model === 'string' && agent.model.startsWith('gemini-2.')) {
              dirty = true;
              return { ...agent, model: 'gemini-4-hydrogen' };
            }
            return agent;
          });

          const hydrated: DatabaseSchema = {
            leads: Array.isArray(parsed.leads) ? parsed.leads : [],
            clients: Array.isArray(parsed.clients) ? parsed.clients : [],
            prospects,
            whatsappConversations: Array.isArray(parsed.whatsappConversations) ? parsed.whatsappConversations : [],
            whatsappLogs: Array.isArray(parsed.whatsappLogs) ? parsed.whatsappLogs.slice(0, 100) : [],
            proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            financialTransactions: Array.isArray(parsed.financialTransactions) ? parsed.financialTransactions : [],
            supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
            aiAgents,
            integrations,
            services: cleanedServices,
            users: cleanedUsers,
            sessions: validSessions,
            crmStages,
            projectStages,
            lastBackup: parsed.lastBackup || new Date().toISOString()
          };

          if (dirty) {
            this.saveToFile(hydrated);
          }
          return hydrated;
        }
      }
    } catch (err) {
      console.warn('Could not read existing db.json, initializing fresh data store:', err);
    }

    const freshIntegrations: SystemIntegrations = JSON.parse(JSON.stringify(initialIntegrations));
    const envPlacesKey = getEnvPlacesKey();
    if (envPlacesKey) {
      freshIntegrations.googlePlaces.apiKey = envPlacesKey;
      freshIntegrations.googlePlaces.enabled = true;
      freshIntegrations.googlePlaces.status = 'conectado';
    }

    const defaultData: DatabaseSchema = {
      leads: initialLeads,
      clients: initialClients,
      prospects: [],
      whatsappConversations: initialWhatsAppConversations,
      whatsappLogs: [],
      proposals: initialProposals,
      projects: initialProjects,
      financialTransactions: initialFinancialTransactions,
      supportTickets: initialSupportTickets,
      aiAgents: initialAIAgents,
      integrations: freshIntegrations,
      services: initialServices,
      users: initialUsers,
      sessions: [],
      crmStages: defaultCrmStages,
      projectStages: defaultProjectStages,
      lastBackup: new Date().toISOString()
    };

    this.saveToFile(defaultData);
    return defaultData;
  }

  private saveToFile(data?: DatabaseSchema) {
    try {
      this.ensureDirectory();
      const target = data || this.db;
      target.lastBackup = new Date().toISOString();
      const content = JSON.stringify(target, null, 2);
      fs.writeFileSync(DB_TMP, content, 'utf-8');
      fs.renameSync(DB_TMP, DB_FILE);
    } catch (err) {
      console.error('Failed to write db.json:', err);
      throw new Error('Erro ao persistir dados no banco local.');
    }
  }

  // --- KANBAN STAGES ---
  public getCrmStages(): KanbanStageConfig[] {
    return [...this.db.crmStages].sort((a, b) => a.order - b.order);
  }

  public saveCrmStages(stages: KanbanStageConfig[]): KanbanStageConfig[] {
    this.db.crmStages = stages.map((s, idx) => ({ ...s, order: idx }));
    this.saveToFile();
    return this.getCrmStages();
  }

  public getProjectStages(): KanbanStageConfig[] {
    return [...this.db.projectStages].sort((a, b) => a.order - b.order);
  }

  public saveProjectStages(stages: KanbanStageConfig[]): KanbanStageConfig[] {
    this.db.projectStages = stages.map((s, idx) => ({ ...s, order: idx }));
    this.saveToFile();
    return this.getProjectStages();
  }

  // --- LEADS ---
  public getLeads(): Lead[] {
    return this.db.leads;
  }

  public saveLead(lead: Lead): Lead {
    const idx = this.db.leads.findIndex((l) => l.id === lead.id);
    const updatedLead: Lead = {
      ...lead,
      priority: lead.priority || 'media',
      history: Array.isArray(lead.history) ? lead.history : [],
      notes: Array.isArray(lead.notes) ? lead.notes : [],
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) {
      this.db.leads[idx] = updatedLead;
    } else {
      this.db.leads.unshift(updatedLead);
    }
    this.saveToFile();
    return updatedLead;
  }

  public deleteLead(id: string): boolean {
    const initialLen = this.db.leads.length;
    this.db.leads = this.db.leads.filter((l) => l.id !== id);
    if (this.db.leads.length !== initialLen) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  public importLeads(newLeads: Lead[]): { imported: number; duplicates: number } {
    let imported = 0;
    let duplicates = 0;

    const existingPhones = new Set(
      this.db.leads.map((l) => (l.whatsapp || l.phone || '').replace(/\D/g, '')).filter(Boolean)
    );
    const existingEmails = new Set(
      this.db.leads.map((l) => (l.email || '').toLowerCase().trim()).filter(Boolean)
    );
    const existingCompanies = new Set(
      this.db.leads.map((l) => (l.company || '').toLowerCase().trim()).filter(Boolean)
    );

    for (const lead of newLeads) {
      const cleanPhone = (lead.whatsapp || lead.phone || '').replace(/\D/g, '');
      const cleanEmail = (lead.email || '').toLowerCase().trim();
      const cleanCompany = (lead.company || '').toLowerCase().trim();

      if (
        (cleanPhone && existingPhones.has(cleanPhone)) ||
        (cleanEmail && existingEmails.has(cleanEmail)) ||
        (cleanCompany && existingCompanies.has(cleanCompany))
      ) {
        duplicates++;
        continue;
      }

      this.db.leads.unshift({
        ...lead,
        priority: lead.priority || 'media',
        history: lead.history || [
          {
            id: `hist_${Date.now()}_${imported}`,
            action: 'Lead importado para o CRM',
            toStage: lead.status || 'novo',
            user: lead.assignedTo || 'Sistema',
            date: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (cleanPhone) existingPhones.add(cleanPhone);
      if (cleanEmail) existingEmails.add(cleanEmail);
      if (cleanCompany) existingCompanies.add(cleanCompany);
      imported++;
    }

    this.saveToFile();
    return { imported, duplicates };
  }

  // --- PROSPECTS STAGING LIST ---
  public getProspects(): ProspectCompany[] {
    return this.db.prospects;
  }

  public saveProspect(prospect: ProspectCompany): ProspectCompany {
    const idx = this.db.prospects.findIndex((p) => p.id === prospect.id);
    if (idx >= 0) {
      this.db.prospects[idx] = prospect;
    } else {
      this.db.prospects.unshift(prospect);
    }
    this.saveToFile();
    return prospect;
  }

  public importProspects(
    items: ProspectCompany[]
  ): { imported: number; duplicates: number; prospects: ProspectCompany[] } {
    let imported = 0;
    let duplicates = 0;

    const knownCompanies = new Set<string>([
      ...this.db.prospects.map((p) => p.company.toLowerCase().trim()),
      ...this.db.leads.map((l) => l.company.toLowerCase().trim())
    ]);
    const knownPhones = new Set<string>([
      ...this.db.prospects.map((p) => (p.whatsapp || p.phone).replace(/\D/g, '')).filter(Boolean),
      ...this.db.leads.map((l) => (l.whatsapp || l.phone).replace(/\D/g, '')).filter(Boolean)
    ]);

    const added: ProspectCompany[] = [];
    for (const item of items) {
      const normComp = (item.company || '').toLowerCase().trim();
      const normPhone = (item.whatsapp || item.phone || '').replace(/\D/g, '');
      if (!normComp) continue;

      if (knownCompanies.has(normComp) || (normPhone && knownPhones.has(normPhone))) {
        duplicates++;
        continue;
      }

      this.db.prospects.unshift(item);
      knownCompanies.add(normComp);
      if (normPhone) knownPhones.add(normPhone);
      added.push(item);
      imported++;
    }

    if (imported > 0) {
      this.saveToFile();
    }
    return { imported, duplicates, prospects: added };
  }

  public deleteProspect(id: string): boolean {
    const len = this.db.prospects.length;
    this.db.prospects = this.db.prospects.filter((p) => p.id !== id);
    if (this.db.prospects.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- CLIENTS ---
  public getClients(): Client[] {
    return this.db.clients;
  }

  public saveClient(client: Client): Client {
    const idx = this.db.clients.findIndex((c) => c.id === client.id);
    if (idx >= 0) {
      this.db.clients[idx] = client;
    } else {
      this.db.clients.unshift(client);
    }
    this.saveToFile();
    return client;
  }

  public deleteClient(id: string): boolean {
    const len = this.db.clients.length;
    this.db.clients = this.db.clients.filter((c) => c.id !== id);
    if (this.db.clients.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- PROPOSALS ---
  public getProposals(): Proposal[] {
    return this.db.proposals;
  }

  public saveProposal(proposal: Proposal): Proposal {
    const idx = this.db.proposals.findIndex((p) => p.id === proposal.id);
    if (idx >= 0) {
      this.db.proposals[idx] = proposal;
    } else {
      this.db.proposals.unshift(proposal);
    }
    this.saveToFile();
    return proposal;
  }

  public approveProposal(id: string, approverName: string): Proposal | null {
    const prop = this.db.proposals.find((p) => p.id === id);
    if (!prop) return null;
    prop.status = 'aprovada';
    prop.approvedBy = approverName;
    prop.history.push({
      action: 'Aprovação formal autorizada pelo administrador',
      date: new Date().toISOString(),
      user: approverName
    });
    this.saveToFile();
    return prop;
  }

  public deleteProposal(id: string): boolean {
    const len = this.db.proposals.length;
    this.db.proposals = this.db.proposals.filter((p) => p.id !== id);
    if (this.db.proposals.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- PROJECTS ---
  public getProjects(): Project[] {
    return this.db.projects;
  }

  public saveProject(project: Project): Project {
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    const doneCount = tasks.filter((t) => t.done).length;
    const calculatedProgress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

    const normalized: Project = {
      ...project,
      tasks,
      progress: calculatedProgress,
      history: Array.isArray(project.history) ? project.history : [],
      updatedAt: new Date().toISOString()
    };

    const idx = this.db.projects.findIndex((p) => p.id === normalized.id);
    if (idx >= 0) {
      this.db.projects[idx] = normalized;
    } else {
      this.db.projects.unshift(normalized);
    }
    this.saveToFile();
    return normalized;
  }

  public deleteProject(id: string): boolean {
    const len = this.db.projects.length;
    this.db.projects = this.db.projects.filter((p) => p.id !== id);
    if (this.db.projects.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- FINANCIAL ---
  public getFinancial(): FinancialTransaction[] {
    return this.db.financialTransactions;
  }

  public saveFinancial(tx: FinancialTransaction): FinancialTransaction {
    const idx = this.db.financialTransactions.findIndex((f) => f.id === tx.id);
    if (idx >= 0) {
      this.db.financialTransactions[idx] = tx;
    } else {
      this.db.financialTransactions.unshift(tx);
    }
    this.saveToFile();
    return tx;
  }

  public deleteFinancial(id: string): boolean {
    const len = this.db.financialTransactions.length;
    this.db.financialTransactions = this.db.financialTransactions.filter((f) => f.id !== id);
    if (this.db.financialTransactions.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- SUPPORT TICKETS ---
  public getSupportTickets(): SupportTicket[] {
    return this.db.supportTickets;
  }

  public saveSupportTicket(ticket: SupportTicket): SupportTicket {
    const idx = this.db.supportTickets.findIndex((t) => t.id === ticket.id);
    if (idx >= 0) {
      this.db.supportTickets[idx] = ticket;
    } else {
      this.db.supportTickets.unshift(ticket);
    }
    this.saveToFile();
    return ticket;
  }

  // --- WHATSAPP LOGS & CONVERSATIONS ---
  public getWhatsAppLogs(): WhatsAppIntegrationLog[] {
    return this.db.whatsappLogs || [];
  }

  public recordWhatsAppLog(
    entry: Omit<WhatsAppIntegrationLog, 'id' | 'timestamp'> & { persist?: boolean }
  ): WhatsAppIntegrationLog {
    const { persist = true, ...rest } = entry;
    const item: WhatsAppIntegrationLog = {
      id: `walog_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      timestamp: new Date().toISOString(),
      ...rest,
      summary: String(rest.summary || '').slice(0, 600)
    };
    if (!Array.isArray(this.db.whatsappLogs)) {
      this.db.whatsappLogs = [];
    }
    this.db.whatsappLogs.unshift(item);
    if (this.db.whatsappLogs.length > 100) {
      this.db.whatsappLogs.length = 100;
    }
    if (persist) {
      this.saveToFile();
    }
    return item;
  }

  public getWhatsAppConversations(): WhatsAppConversation[] {
    return this.db.whatsappConversations;
  }

  public findWhatsAppConversationByPhone(
    phone: string,
    phoneNumberId?: string
  ): WhatsAppConversation | undefined {
    const normalized = normalizePhoneForMeta(phone);
    if (!normalized) return undefined;
    const targetPid = String(phoneNumberId || '').trim();
    return this.db.whatsappConversations.find((c) => {
      if (!phonesMatch(c.contactPhone, normalized)) return false;
      const convPid = String(c.phoneNumberId || '').trim();
      if (targetPid && targetPid !== 'default' && convPid && convPid !== 'default') {
        return convPid === targetPid;
      }
      return true;
    });
  }

  public hasProcessedWamid(wamid: string): boolean {
    const clean = (wamid || '').trim();
    if (!clean) return false;
    return this.db.whatsappConversations.some((c) =>
      c.messages.some((m) => m.metaMessageId === clean)
    );
  }

  public saveWhatsAppConversation(
    conv: WhatsAppConversation,
    options?: { exactIdOnly?: boolean }
  ): WhatsAppConversation {
    const normalizedPhone = normalizePhoneForMeta(conv.contactPhone) || conv.contactPhone;
    const effectivePid =
      String(conv.phoneNumberId || this.db.integrations?.metaCloud?.phoneNumberId || 'default').trim() ||
      'default';
    const waId = normalizePhoneForMeta(conv.waId || normalizedPhone) || normalizedPhone;
    const normalizedConv: WhatsAppConversation = {
      ...conv,
      contactPhone: normalizedPhone,
      waId,
      phoneNumberId: effectivePid,
      ...(conv.conversationKey ? { conversationKey: conv.conversationKey } : {}),
      aiPaused: Boolean(conv.aiPaused),
      handoverHistory: Array.isArray(conv.handoverHistory) ? conv.handoverHistory : []
    };
    const idxById = this.db.whatsappConversations.findIndex((c) => c.id === normalizedConv.id);
    if (idxById >= 0) {
      this.db.whatsappConversations[idxById] = normalizedConv;
    } else if (options?.exactIdOnly) {
      this.db.whatsappConversations.unshift(normalizedConv);
    } else {
      const idxByKeyOrPhone = this.db.whatsappConversations.findIndex((c) => {
        if (normalizedConv.conversationKey && c.conversationKey === normalizedConv.conversationKey) {
          return true;
        }
        if (!phonesMatch(c.contactPhone, normalizedPhone)) return false;
        const cPid = String(c.phoneNumberId || '').trim();
        if (effectivePid !== 'default' && cPid && cPid !== 'default') {
          return cPid === effectivePid;
        }
        return true;
      });
      if (idxByKeyOrPhone >= 0) {
        this.db.whatsappConversations[idxByKeyOrPhone] = {
          ...this.db.whatsappConversations[idxByKeyOrPhone],
          ...normalizedConv,
          id: this.db.whatsappConversations[idxByKeyOrPhone].id
        };
      } else {
        this.db.whatsappConversations.unshift(normalizedConv);
      }
    }
    this.saveToFile();
    return (
      this.db.whatsappConversations.find((c) => c.id === normalizedConv.id) ||
      this.findWhatsAppConversationByPhone(normalizedPhone, effectivePid) ||
      normalizedConv
    );
  }

  public deleteWhatsAppConversation(id: string): boolean {
    const len = this.db.whatsappConversations.length;
    this.db.whatsappConversations = this.db.whatsappConversations.filter((c) => c.id !== id);
    if (this.db.whatsappConversations.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  public addWhatsAppMessage(
    conversationId: string,
    message: {
      sender: 'contact' | 'agent' | 'system';
      direction?: 'inbound' | 'outbound' | 'system';
      senderName?: string;
      text: string;
      aiGenerated?: boolean;
      status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
      metaMessageId?: string;
      phoneNumberId?: string;
      waId?: string;
      errorMessage?: string;
    }
  ) {
    const conv = this.db.whatsappConversations.find((c) => c.id === conversationId);
    if (!conv) return null;

    if (
      message.metaMessageId &&
      this.hasProcessedWamid(message.metaMessageId)
    ) {
      return null;
    }

    const defaultStatus = message.sender === 'contact' ? 'delivered' : 'sent';
    const direction =
      message.direction ||
      (message.sender === 'contact' ? 'inbound' : message.sender === 'agent' ? 'outbound' : 'system');
    const nowIso = new Date().toISOString();
    const newMsg = {
      id: message.metaMessageId
        ? `wamid_${String(message.metaMessageId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110)}`
        : `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      sender: message.sender,
      direction,
      senderName: message.senderName,
      text: message.text,
      timestamp: nowIso,
      status: message.status || defaultStatus,
      ...(message.metaMessageId ? { metaMessageId: message.metaMessageId } : {}),
      ...(message.phoneNumberId || conv.phoneNumberId
        ? { phoneNumberId: message.phoneNumberId || conv.phoneNumberId }
        : {}),
      ...(message.waId || conv.waId || conv.contactPhone
        ? { waId: message.waId || conv.waId || conv.contactPhone }
        : {}),
      ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
      aiGenerated: message.aiGenerated
    };

    conv.messages.push(newMsg);
    conv.lastMessage = message.text;
    conv.lastMessageTimestamp = nowIso;
    if (message.sender === 'contact') {
      conv.lastInboundAt = nowIso;
      conv.unreadCount = (conv.unreadCount || 0) + 1;
      if (conv.status === 'resolved') {
        conv.status = conv.aiPaused ? 'human_takeover' : 'ai_active';
        conv.assignedAgent = conv.aiPaused ? (conv.assignedAgent || 'Humano') : 'Atendente IA';
      }
    } else if (message.sender === 'agent') {
      conv.unreadCount = 0;
    }

    this.saveToFile();
    return { conversation: conv, message: newMsg };
  }

  public setWhatsAppHandover(params: {
    conversationId: string;
    status: 'ai_active' | 'human_takeover' | 'resolved';
    assignedAgent: string;
    assignedUserId?: string;
    aiPaused?: boolean;
    byUser: string;
    action: WhatsAppHandoverEntry['action'];
    note?: string;
  }): WhatsAppConversation | null {
    const conv = this.db.whatsappConversations.find((c) => c.id === params.conversationId);
    if (!conv) return null;

    const prevStatus = conv.status;
    const nowIso = new Date().toISOString();
    conv.status = params.status;
    conv.assignedAgent = params.assignedAgent;
    if (params.assignedUserId !== undefined) {
      conv.assignedUserId = params.assignedUserId || undefined;
    }
    if (params.aiPaused !== undefined) {
      conv.aiPaused = params.aiPaused;
    } else if (params.status === 'ai_active') {
      conv.aiPaused = false;
    }

    if (params.status === 'resolved') {
      conv.closedAt = nowIso;
      conv.closedBy = params.byUser;
    } else {
      conv.closedAt = undefined;
      conv.closedBy = undefined;
    }

    const entry: WhatsAppHandoverEntry = {
      id: `ho_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      action: params.action,
      fromStatus: prevStatus,
      toStatus: params.status,
      assignedTo: params.assignedAgent,
      byUser: params.byUser,
      ...(params.note ? { note: params.note } : {}),
      at: nowIso
    };
    conv.handoverHistory = [...(conv.handoverHistory || []), entry].slice(-50);

    this.saveToFile();
    return conv;
  }

  public updateWhatsAppMessageStatus(
    metaMessageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    errorMessage?: string
  ): { conversation: WhatsAppConversation; message: WhatsAppConversation['messages'][number] } | null {
    if (!metaMessageId) return null;
    for (const conv of this.db.whatsappConversations) {
      const msg = conv.messages.find((m) => m.metaMessageId === metaMessageId);
      if (msg) {
        msg.status = status;
        if (errorMessage) {
          msg.errorMessage = errorMessage;
        }
        this.saveToFile();
        return { conversation: conv, message: msg };
      }
    }
    return null;
  }

  public markWhatsAppConversationRead(conversationId: string): WhatsAppConversation | null {
    const conv = this.db.whatsappConversations.find((c) => c.id === conversationId);
    if (!conv) return null;
    if ((conv.unreadCount || 0) !== 0) {
      conv.unreadCount = 0;
      this.saveToFile();
    }
    return conv;
  }

  private mergeMessageLists(existing: ChatMessage[], incoming: ChatMessage[]): { list: ChatMessage[]; changed: boolean } {
    const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    const byKey = new Map<string, ChatMessage>();
    let changed = false;

    const getKey = (m: ChatMessage) =>
      m.metaMessageId ? `wamid:${m.metaMessageId}` : `id:${m.id}`;

    for (const m of existing) {
      byKey.set(getKey(m), m);
    }

    for (const m of incoming) {
      const key = getKey(m);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, m);
        changed = true;
      } else {
        const prevRank = STATUS_RANK[prev.status || 'sent'] ?? 1;
        const nextRank = STATUS_RANK[m.status || 'sent'] ?? 1;
        if (
          nextRank > prevRank ||
          (!prev.metaMessageId && m.metaMessageId) ||
          (!prev.errorMessage && m.errorMessage)
        ) {
          byKey.set(key, {
            ...prev,
            ...m,
            id: prev.id,
            status: nextRank >= prevRank ? m.status : prev.status,
            metaMessageId: m.metaMessageId || prev.metaMessageId,
            errorMessage: m.errorMessage || prev.errorMessage
          });
          changed = true;
        }
      }
    }

    const list = Array.from(byKey.values()).sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
    );
    return { list, changed };
  }

  private mergeHandoverLists(
    existing: WhatsAppHandoverEntry[],
    incoming: WhatsAppHandoverEntry[]
  ): { list: WhatsAppHandoverEntry[]; changed: boolean } {
    const byId = new Map<string, WhatsAppHandoverEntry>();
    let changed = false;
    for (const h of existing) {
      byId.set(h.id, h);
    }
    for (const h of incoming) {
      if (!byId.has(h.id)) {
        byId.set(h.id, h);
        changed = true;
      }
    }
    const list = Array.from(byId.values())
      .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
      .slice(-50);
    return { list, changed };
  }

  public mergeWhatsAppConversationsFromFirestore(convs: WhatsAppConversation[]): WhatsAppConversation[] {
    if (!Array.isArray(convs) || convs.length === 0) {
      return this.db.whatsappConversations;
    }

    let anyChanged = false;
    for (const remote of convs) {
      if (!remote || !remote.id) continue;
      const normPhone = normalizePhoneForMeta(remote.contactPhone) || remote.contactPhone || '';
      const existingIdx = this.db.whatsappConversations.findIndex((c) => c.id === remote.id);

      if (existingIdx < 0) {
        this.db.whatsappConversations.unshift({
          ...remote,
          contactPhone: normPhone || remote.contactPhone,
          waId: normalizePhoneForMeta(remote.waId || normPhone) || normPhone,
          ...(remote.phoneNumberId ? { phoneNumberId: remote.phoneNumberId } : {}),
          ...(remote.conversationKey ? { conversationKey: remote.conversationKey } : {}),
          aiPaused: Boolean(remote.aiPaused),
          handoverHistory: Array.isArray(remote.handoverHistory) ? remote.handoverHistory : [],
          messages: Array.isArray(remote.messages) ? remote.messages : []
        });
        anyChanged = true;
      } else {
        const local = this.db.whatsappConversations[existingIdx];
        const remoteTs = Date.parse(remote.lastMessageTimestamp || '') || 0;
        const localTs = Date.parse(local.lastMessageTimestamp || '') || 0;
        const preferRemoteMeta = remoteTs >= localTs;

        const msgMerge = this.mergeMessageLists(
          local.messages || [],
          Array.isArray(remote.messages) ? remote.messages : []
        );
        const hoMerge = this.mergeHandoverLists(
          local.handoverHistory || [],
          Array.isArray(remote.handoverHistory) ? remote.handoverHistory : []
        );

        const remoteHoLen = hoMerge.list.length;
        const localHoLen = (local.handoverHistory || []).length;
        const useRemoteState =
          preferRemoteMeta || remoteHoLen > localHoLen;

        if (msgMerge.changed || hoMerge.changed || preferRemoteMeta || useRemoteState) {
          const nextConv: WhatsAppConversation = {
            ...local,
            ...(remote.phoneNumberId ? { phoneNumberId: remote.phoneNumberId } : {}),
            ...(remote.waId ? { waId: normalizePhoneForMeta(remote.waId) } : {}),
            ...(remote.conversationKey ? { conversationKey: remote.conversationKey } : {}),
            ...(preferRemoteMeta
              ? {
                  contactName: remote.contactName || local.contactName,
                  contactPhone: normPhone || local.contactPhone,
                  lastMessage: remote.lastMessage || local.lastMessage,
                  lastMessageTimestamp: remote.lastMessageTimestamp || local.lastMessageTimestamp,
                  lastInboundAt: remote.lastInboundAt || local.lastInboundAt,
                  unreadCount: remote.unreadCount ?? local.unreadCount,
                  leadId: remote.leadId ?? local.leadId,
                  clientId: remote.clientId ?? local.clientId
                }
              : {}),
            ...(useRemoteState
              ? {
                  status: remote.status,
                  aiPaused: Boolean(remote.aiPaused),
                  assignedAgent: remote.assignedAgent || local.assignedAgent,
                  assignedUserId: remote.assignedUserId ?? local.assignedUserId,
                  closedAt: remote.closedAt ?? local.closedAt,
                  closedBy: remote.closedBy ?? local.closedBy
                }
              : {}),
            messages: msgMerge.list,
            handoverHistory: hoMerge.list
          };

          if (
            JSON.stringify({ ...local, messages: local.messages.length, handoverHistory: local.handoverHistory?.length }) !==
              JSON.stringify({ ...nextConv, messages: nextConv.messages.length, handoverHistory: nextConv.handoverHistory?.length }) ||
            msgMerge.changed ||
            hoMerge.changed
          ) {
            this.db.whatsappConversations[existingIdx] = nextConv;
            anyChanged = true;
          }
        }
      }
    }

    if (anyChanged) {
      this.db.whatsappConversations.sort(
        (a, b) =>
          new Date(b.lastMessageTimestamp || 0).getTime() -
          new Date(a.lastMessageTimestamp || 0).getTime()
      );
      this.saveToFile();
    }
    return this.db.whatsappConversations;
  }

  public applyMergedWhatsAppConversation(
    merged: WhatsAppConversation,
    removedIds: string[]
  ): WhatsAppConversation[] {
    const removeSet = new Set(removedIds.filter((id) => id && id !== merged.id));
    this.db.whatsappConversations = this.db.whatsappConversations.filter(
      (c) => !removeSet.has(c.id) && c.id !== merged.id
    );
    const normPhone = normalizePhoneForMeta(merged.contactPhone) || merged.contactPhone;
    const cleanMerged: WhatsAppConversation = {
      ...merged,
      contactPhone: normPhone,
      waId: normalizePhoneForMeta(merged.waId || normPhone) || normPhone,
      aiPaused: Boolean(merged.aiPaused),
      handoverHistory: Array.isArray(merged.handoverHistory) ? merged.handoverHistory : [],
      messages: Array.isArray(merged.messages) ? merged.messages : []
    };
    this.db.whatsappConversations.unshift(cleanMerged);
    this.db.whatsappConversations.sort(
      (a, b) =>
        new Date(b.lastMessageTimestamp || 0).getTime() -
        new Date(a.lastMessageTimestamp || 0).getTime()
    );
    this.saveToFile();
    return this.db.whatsappConversations;
  }

  public mergeWhatsAppMessagesForConversation(
    conversationId: string,
    messages: ChatMessage[],
    handovers?: WhatsAppHandoverEntry[]
  ): WhatsAppConversation | null {
    const idx = this.db.whatsappConversations.findIndex((c) => c.id === conversationId);
    if (idx < 0) return null;
    const local = this.db.whatsappConversations[idx];
    const msgMerge = this.mergeMessageLists(local.messages || [], messages || []);
    const hoMerge = this.mergeHandoverLists(local.handoverHistory || [], handovers || []);

    if (!msgMerge.changed && !hoMerge.changed) {
      return local;
    }

    const latestMsg = msgMerge.list[msgMerge.list.length - 1];
    const localTs = Date.parse(local.lastMessageTimestamp || '') || 0;
    const latestMsgTs = latestMsg ? Date.parse(latestMsg.timestamp || '') || 0 : 0;

    const updated: WhatsAppConversation = {
      ...local,
      messages: msgMerge.list,
      handoverHistory: hoMerge.list,
      ...(latestMsg && latestMsgTs > localTs
        ? {
            lastMessage: latestMsg.text,
            lastMessageTimestamp: latestMsg.timestamp
          }
        : {})
    };
    this.db.whatsappConversations[idx] = updated;
    this.saveToFile();
    return updated;
  }

  public mergeWhatsAppLogsFromFirestore(logs: WhatsAppIntegrationLog[]): WhatsAppIntegrationLog[] {
    if (!Array.isArray(logs) || logs.length === 0) return this.db.whatsappLogs || [];
    const current = Array.isArray(this.db.whatsappLogs) ? this.db.whatsappLogs : [];
    const byId = new Map<string, WhatsAppIntegrationLog>();
    for (const l of current) {
      if (l?.id) byId.set(l.id, l);
    }
    let changed = false;
    for (const l of logs) {
      if (l?.id && !byId.has(l.id)) {
        byId.set(l.id, l);
        changed = true;
      }
    }
    if (changed) {
      this.db.whatsappLogs = Array.from(byId.values())
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, 100);
      this.saveToFile();
    }
    return this.db.whatsappLogs;
  }

  // --- AI AGENTS & CONFIGS ---
  public getAIAgents(): AIAgentConfig[] {
    return this.db.aiAgents;
  }

  public updateAIAgent(agent: AIAgentConfig): AIAgentConfig {
    const idx = this.db.aiAgents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      this.db.aiAgents[idx] = agent;
      this.saveToFile();
    }
    return agent;
  }

  // Raw integrations for backend-only consumption
  public getIntegrations(): SystemIntegrations {
    return this.db.integrations;
  }

  // Sanitized integrations for API responses (NEVER exposes API keys or tokens)
  public getSanitizedIntegrations(): SystemIntegrations {
    const raw = this.db.integrations;
    return {
      metaCloud: {
        enabled: raw.metaCloud.enabled,
        phoneNumberId: raw.metaCloud.phoneNumberId,
        wabaId: raw.metaCloud.wabaId,
        webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
        lastSyncedAt: raw.metaCloud.lastSyncedAt,
        connectedPhoneDisplay: raw.metaCloud.connectedPhoneDisplay,
        connectedVerifiedName: raw.metaCloud.connectedVerifiedName,
        phpWebhookVerified: raw.metaCloud.phpWebhookVerified,
        hasAccessToken: Boolean(raw.metaCloud.accessToken && raw.metaCloud.accessToken.trim()),
        hasWebhookVerifyToken: Boolean(raw.metaCloud.webhookVerifyToken && raw.metaCloud.webhookVerifyToken.trim()),
        hasAppSecret: Boolean(raw.metaCloud.appSecret && raw.metaCloud.appSecret.trim()),
        hasBridgeSecret: Boolean(raw.metaCloud.bridgeSecret && raw.metaCloud.bridgeSecret.trim()),
        accessTokenHint: maskSecretHint(raw.metaCloud.accessToken),
        webhookVerifyTokenHint: maskSecretHint(raw.metaCloud.webhookVerifyToken),
        appSecretHint: maskSecretHint(raw.metaCloud.appSecret),
        bridgeSecretHint: maskSecretHint(raw.metaCloud.bridgeSecret),
        status: raw.metaCloud.status
      },
      googlePlaces: {
        enabled: raw.googlePlaces.enabled,
        hasApiKey: Boolean(raw.googlePlaces.apiKey && raw.googlePlaces.apiKey.trim()),
        apiKeyHint: maskSecretHint(raw.googlePlaces.apiKey),
        status: raw.googlePlaces.status
      },
      asaas: {
        enabled: raw.asaas.enabled,
        environment: raw.asaas.environment,
        hasApiKey: Boolean(raw.asaas.apiKey && raw.asaas.apiKey.trim()),
        hasWebhookSecret: Boolean(raw.asaas.webhookSecret && raw.asaas.webhookSecret.trim()),
        apiKeyHint: maskSecretHint(raw.asaas.apiKey),
        status: raw.asaas.status
      },
      gemini: {
        enabled: raw.gemini.enabled,
        model: raw.gemini.model,
        requestsToday: raw.gemini.requestsToday,
        quotaLimit: raw.gemini.quotaLimit,
        hasEnvKey: Boolean(
          process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
          process.env.GEMINI_API_KEY.trim().length > 5
        ),
        status: raw.gemini.status
      }
    };
  }

  public generateBridgeSecret(): { bridgeSecret: string; integrations: SystemIntegrations } {
    const secret = `fmws_br_${crypto.randomBytes(24).toString('hex')}`;
    this.db.integrations.metaCloud = {
      ...this.db.integrations.metaCloud,
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      bridgeSecret: secret
    };
    this.saveToFile();
    return {
      bridgeSecret: secret,
      integrations: this.getSanitizedIntegrations()
    };
  }

  public setMetaConnectionVerification(result: {
    ok: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    phpWebhookVerified?: boolean;
    syncedAt?: string;
  }): SystemIntegrations {
    const cur = this.db.integrations.metaCloud;
    const configured = Boolean(cur.phoneNumberId?.trim() && cur.accessToken?.trim());
    const nowIso = result.syncedAt || new Date().toISOString();

    this.db.integrations.metaCloud = {
      ...cur,
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      lastSyncedAt: nowIso,
      ...(result.displayPhoneNumber ? { connectedPhoneDisplay: result.displayPhoneNumber } : {}),
      ...(result.verifiedName ? { connectedVerifiedName: result.verifiedName } : {}),
      ...(result.phpWebhookVerified !== undefined ? { phpWebhookVerified: result.phpWebhookVerified } : {}),
      status: !configured
        ? 'nao_configurado'
        : !cur.enabled
        ? 'desconectado'
        : result.ok
        ? 'conectado'
        : 'erro'
    };
    this.saveToFile();
    return this.getSanitizedIntegrations();
  }

  public setPhpWebhookVerified(verified: boolean, syncedAt?: string): SystemIntegrations {
    const cur = this.db.integrations.metaCloud;
    this.db.integrations.metaCloud = {
      ...cur,
      webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
      phpWebhookVerified: verified,
      lastSyncedAt: syncedAt || cur.lastSyncedAt || new Date().toISOString()
    };
    this.saveToFile();
    return this.getSanitizedIntegrations();
  }

  public updateIntegrations(incoming: Partial<SystemIntegrations>): SystemIntegrations {
    const cur = this.db.integrations;

    if (incoming.metaCloud) {
      const nextAccessToken =
        incoming.metaCloud.accessToken === '__CLEAR__'
          ? ''
          : incoming.metaCloud.accessToken?.trim()
          ? incoming.metaCloud.accessToken.trim()
          : cur.metaCloud.accessToken || '';

      const nextVerifyToken =
        incoming.metaCloud.webhookVerifyToken === '__CLEAR__'
          ? ''
          : incoming.metaCloud.webhookVerifyToken?.trim()
          ? incoming.metaCloud.webhookVerifyToken.trim()
          : cur.metaCloud.webhookVerifyToken || '';

      const nextAppSecret =
        incoming.metaCloud.appSecret === '__CLEAR__'
          ? ''
          : incoming.metaCloud.appSecret?.trim()
          ? incoming.metaCloud.appSecret.trim()
          : cur.metaCloud.appSecret || '';

      const nextBridgeSecret =
        incoming.metaCloud.bridgeSecret === '__CLEAR__'
          ? ''
          : incoming.metaCloud.bridgeSecret?.trim()
          ? incoming.metaCloud.bridgeSecret.trim()
          : cur.metaCloud.bridgeSecret || '';

      const phoneNumberId =
        incoming.metaCloud.phoneNumberId !== undefined
          ? incoming.metaCloud.phoneNumberId.trim()
          : cur.metaCloud.phoneNumberId;
      const wabaId =
        incoming.metaCloud.wabaId !== undefined
          ? incoming.metaCloud.wabaId.trim()
          : cur.metaCloud.wabaId;
      const enabled = incoming.metaCloud.enabled ?? cur.metaCloud.enabled;
      const configured = Boolean(phoneNumberId && nextAccessToken);

      const credentialsChanged =
        phoneNumberId !== cur.metaCloud.phoneNumberId ||
        wabaId !== cur.metaCloud.wabaId ||
        nextAccessToken !== (cur.metaCloud.accessToken || '') ||
        nextAppSecret !== (cur.metaCloud.appSecret || '');

      // Never falsely mark 'conectado' on plain save when credentials changed or were unverified
      let nextStatus: SystemIntegrations['metaCloud']['status'];
      if (!configured) {
        nextStatus = 'nao_configurado';
      } else if (!enabled) {
        nextStatus = 'desconectado';
      } else if (credentialsChanged) {
        nextStatus = 'desconectado';
      } else {
        nextStatus = cur.metaCloud.status === 'conectado' ? 'conectado' : 'desconectado';
      }

      cur.metaCloud = {
        ...cur.metaCloud,
        enabled: configured && enabled,
        phoneNumberId,
        wabaId,
        accessToken: nextAccessToken,
        webhookVerifyToken: nextVerifyToken,
        appSecret: nextAppSecret,
        bridgeSecret: nextBridgeSecret,
        webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
        status: nextStatus
      };
    }

    if (incoming.googlePlaces) {
      const nextApiKey =
        incoming.googlePlaces.apiKey === '__CLEAR__'
          ? ''
          : incoming.googlePlaces.apiKey?.trim()
          ? incoming.googlePlaces.apiKey.trim()
          : cur.googlePlaces.apiKey || '';

      const enabled = incoming.googlePlaces.enabled ?? cur.googlePlaces.enabled;
      const configured = Boolean(nextApiKey);

      cur.googlePlaces = {
        enabled: configured && enabled,
        apiKey: nextApiKey,
        status: configured ? (enabled ? 'conectado' : 'desconectado') : 'nao_configurado'
      };
    }

    if (incoming.asaas) {
      const nextApiKey =
        incoming.asaas.apiKey === '__CLEAR__'
          ? ''
          : incoming.asaas.apiKey?.trim()
          ? incoming.asaas.apiKey.trim()
          : cur.asaas.apiKey || '';

      const nextWebhookSecret =
        incoming.asaas.webhookSecret === '__CLEAR__'
          ? ''
          : incoming.asaas.webhookSecret?.trim()
          ? incoming.asaas.webhookSecret.trim()
          : cur.asaas.webhookSecret || '';

      const enabled = incoming.asaas.enabled ?? cur.asaas.enabled;
      const configured = Boolean(nextApiKey);

      cur.asaas = {
        enabled: configured && enabled,
        apiKey: nextApiKey,
        environment: incoming.asaas.environment ?? cur.asaas.environment,
        webhookSecret: nextWebhookSecret,
        status: configured ? (enabled ? 'conectado' : 'desconectado') : 'nao_configurado'
      };
    }

    if (incoming.gemini) {
      const hasEnvKey = Boolean(
        process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
        process.env.GEMINI_API_KEY.trim().length > 5
      );
      const nextEnabled = hasEnvKey ? (incoming.gemini.enabled ?? cur.gemini.enabled) : false;
      const nextModel =
        typeof incoming.gemini.model === 'string' && incoming.gemini.model.trim()
          ? incoming.gemini.model.trim()
          : cur.gemini.model || 'gemini-4-hydrogen';
      const nextQuota =
        typeof incoming.gemini.quotaLimit === 'number' && Number.isFinite(incoming.gemini.quotaLimit) && incoming.gemini.quotaLimit > 0
          ? Math.floor(incoming.gemini.quotaLimit)
          : cur.gemini.quotaLimit || 1500;
      const nextRequests =
        typeof incoming.gemini.requestsToday === 'number' && Number.isFinite(incoming.gemini.requestsToday) && incoming.gemini.requestsToday >= 0
          ? Math.floor(incoming.gemini.requestsToday)
          : cur.gemini.requestsToday;

      const derivedStatus = !hasEnvKey
        ? 'nao_configurado'
        : !nextEnabled
        ? 'desconectado'
        : incoming.gemini.status ??
          (cur.gemini.status === 'nao_configurado' || cur.gemini.status === 'desconectado'
            ? 'conectado'
            : cur.gemini.status);

      cur.gemini = {
        ...cur.gemini,
        enabled: nextEnabled,
        model: nextModel,
        quotaLimit: nextQuota,
        requestsToday: nextRequests,
        status: derivedStatus
      };

      if ((incoming.gemini as any).syncAgents) {
        this.db.aiAgents = this.db.aiAgents.map((agent) => ({
          ...agent,
          model: nextModel
        }));
      }
    }

    this.saveToFile();
    return this.getSanitizedIntegrations();
  }

  // --- SERVICES ---
  public getServices(): ServiceProduct[] {
    return this.db.services;
  }

  public saveService(service: ServiceProduct): ServiceProduct {
    const idx = this.db.services.findIndex((s) => s.id === service.id);
    if (idx >= 0) {
      this.db.services[idx] = service;
    } else {
      this.db.services.unshift(service);
    }
    this.saveToFile();
    return service;
  }

  public deleteService(id: string): boolean {
    const len = this.db.services.length;
    this.db.services = this.db.services.filter((s) => s.id !== id);
    if (this.db.services.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  // --- USERS & PERSISTED SESSIONS ---
  private setupLock = false;

  public getUsers(): StoredUser[] {
    return this.db.users;
  }

  public hasConfiguredAdmin(): boolean {
    return this.db.users.some(
      (u) =>
        u.role === 'admin' &&
        (Boolean(u.passwordHash && u.passwordHash.trim().length >= 10) ||
          Boolean(u.linkedGoogleEmail && u.linkedGoogleEmail.includes('@')))
    );
  }

  public setupInitialAdmin(params: {
    name: string;
    email: string;
    passwordHash?: string;
    linkedGoogleEmail?: string;
    avatar?: string;
  }): StoredUser {
    if (this.setupLock) {
      throw new Error('SETUP_LOCKED');
    }
    this.setupLock = true;
    try {
      // Atomic re-check directly from persisted disk file before writing
      if (fs.existsSync(DB_FILE)) {
        try {
          const diskParsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DatabaseSchema>;
          if (Array.isArray(diskParsed.users)) {
            this.db.users = diskParsed.users;
          }
        } catch {
          // keep current validated state
        }
      }

      if (this.hasConfiguredAdmin()) {
        throw new Error('ADMIN_ALREADY_EXISTS');
      }

      const existingAdmin = this.db.users.find((u) => u.role === 'admin') || this.db.users[0];
      const now = new Date().toISOString();
      const adminUser: StoredUser = existingAdmin
        ? {
            ...existingAdmin,
            name: params.name,
            email: params.email,
            role: 'admin',
            active: true,
            ...(params.avatar ? { avatar: params.avatar } : {}),
            ...(params.passwordHash ? { passwordHash: params.passwordHash } : {}),
            ...(params.linkedGoogleEmail ? { linkedGoogleEmail: params.linkedGoogleEmail } : {}),
            createdAt: existingAdmin.createdAt || now
          }
        : {
            id: 'usr_admin',
            name: params.name,
            email: params.email,
            role: 'admin',
            avatar:
              params.avatar ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(params.name)}&background=D4A72C&color=090B10&bold=true`,
            active: true,
            ...(params.passwordHash ? { passwordHash: params.passwordHash } : {}),
            ...(params.linkedGoogleEmail ? { linkedGoogleEmail: params.linkedGoogleEmail } : {}),
            createdAt: now
          };

      return this.saveUser(adminUser);
    } finally {
      this.setupLock = false;
    }
  }

  public saveUser(user: StoredUser): StoredUser {
    const idx = this.db.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      this.db.users[idx] = user;
    } else {
      this.db.users.push(user);
    }
    this.saveToFile();
    return user;
  }

  public deleteUser(id: string): boolean {
    const len = this.db.users.length;
    this.db.users = this.db.users.filter((u) => u.id !== id);
    if (this.db.users.length !== len) {
      this.db.sessions = this.db.sessions.filter((s) => s.userId !== id);
      this.saveToFile();
      return true;
    }
    return false;
  }

  public createSession(userId: string, role: StoredUser['role']): SessionRecord {
    const now = Date.now();
    // Prune expired sessions and keep database tidy
    this.db.sessions = this.db.sessions.filter((s) => s.expiresAt > now);
    const session: SessionRecord = {
      sid: `sess_${crypto.randomBytes(24).toString('hex')}`,
      userId,
      role,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_TTL_MS
    };
    this.db.sessions.push(session);
    this.saveToFile();
    return session;
  }

  public getSessionById(sid: string): SessionRecord | undefined {
    const now = Date.now();
    const inMem = this.db.sessions.find((s) => s.sid === sid && s.expiresAt > now);
    if (inMem) return inMem;

    if (fs.existsSync(DB_FILE)) {
      try {
        const diskParsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DatabaseSchema>;
        if (Array.isArray(diskParsed.sessions)) {
          const onDisk = diskParsed.sessions.find((s) => s && s.sid === sid && s.expiresAt > now);
          if (onDisk) {
            this.db.sessions = diskParsed.sessions.filter((s) => s && s.sid && s.expiresAt > now);
            return onDisk;
          }
        }
      } catch {
        // ignore parse race
      }
    }
    return undefined;
  }

  public deleteSession(sid: string): boolean {
    const len = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.sid !== sid);
    if (this.db.sessions.length !== len) {
      this.saveToFile();
      return true;
    }
    return false;
  }

  public deleteSessionsForUser(userId: string): void {
    const len = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.userId !== userId);
    if (this.db.sessions.length !== len) {
      this.saveToFile();
    }
  }

  // --- CLOUD SYNC SNAPSHOT (NEVER EXPOSES META/WHATSAPP TOKENS OR SECRETS) ---
  public getCloudSyncExport() {
    const rawInt = this.db.integrations;
    const encryptedVault = encryptVaultPayload({
      googlePlacesApiKey: rawInt.googlePlaces.apiKey,
      asaasApiKey: rawInt.asaas.apiKey,
      asaasWebhookSecret: rawInt.asaas.webhookSecret
    });

    return {
      users: this.db.users.map(({ passwordHash, ...u }) => ({
        ...u,
        ...(passwordHash ? { passwordHash } : {}),
        hasPassword: Boolean(passwordHash)
      })),
      buckets: {
        leads: this.db.leads,
        clients: this.db.clients,
        prospects: this.db.prospects,
        whatsappConversations: this.db.whatsappConversations,
        whatsappLogs: (this.db.whatsappLogs || []).slice(0, 30),
        proposals: this.db.proposals,
        projects: this.db.projects,
        financialTransactions: this.db.financialTransactions,
        supportTickets: this.db.supportTickets,
        aiAgents: this.db.aiAgents,
        services: this.db.services,
        crmStages: this.db.crmStages,
        projectStages: this.db.projectStages,
        integrationsConfig: [
          {
            gemini: {
              enabled: rawInt.gemini.enabled,
              model: rawInt.gemini.model,
              quotaLimit: rawInt.gemini.quotaLimit,
              requestsToday: rawInt.gemini.requestsToday
            },
            metaCloud: {
              enabled: rawInt.metaCloud.enabled,
              phoneNumberId: rawInt.metaCloud.phoneNumberId,
              wabaId: rawInt.metaCloud.wabaId,
              webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
              ...(rawInt.metaCloud.lastSyncedAt ? { lastSyncedAt: rawInt.metaCloud.lastSyncedAt } : {}),
              ...(rawInt.metaCloud.connectedPhoneDisplay
                ? { connectedPhoneDisplay: rawInt.metaCloud.connectedPhoneDisplay }
                : {}),
              ...(rawInt.metaCloud.connectedVerifiedName
                ? { connectedVerifiedName: rawInt.metaCloud.connectedVerifiedName }
                : {}),
              ...(rawInt.metaCloud.phpWebhookVerified !== undefined
                ? { phpWebhookVerified: rawInt.metaCloud.phpWebhookVerified }
                : {})
            },
            googlePlaces: {
              enabled: rawInt.googlePlaces.enabled
            },
            asaas: {
              enabled: rawInt.asaas.enabled,
              environment: rawInt.asaas.environment
            },
            syncedAt: this.db.lastBackup || new Date().toISOString(),
            ...(encryptedVault ? { encryptedVault } : {})
          }
        ]
      }
    };
  }

  public restoreCloudSyncBuckets(
    buckets: Record<string, any[]>,
    users?: any[],
    options?: { onlyFillMissing?: boolean }
  ) {
    const onlyFillMissing = Boolean(options?.onlyFillMissing);

    if (!onlyFillMissing) {
      if (Array.isArray(buckets.leads)) this.db.leads = buckets.leads;
      if (Array.isArray(buckets.clients)) this.db.clients = buckets.clients;
      if (Array.isArray(buckets.prospects)) this.db.prospects = buckets.prospects;
      if (Array.isArray(buckets.whatsappConversations)) {
        this.db.whatsappConversations = buckets.whatsappConversations;
      }
      if (Array.isArray(buckets.whatsappLogs)) {
        this.db.whatsappLogs = buckets.whatsappLogs.slice(0, 100);
      }
      if (Array.isArray(buckets.proposals)) this.db.proposals = buckets.proposals;
      if (Array.isArray(buckets.projects)) this.db.projects = buckets.projects;
      if (Array.isArray(buckets.financialTransactions)) {
        this.db.financialTransactions = buckets.financialTransactions;
      }
      if (Array.isArray(buckets.supportTickets)) this.db.supportTickets = buckets.supportTickets;
      if (Array.isArray(buckets.aiAgents) && buckets.aiAgents.length > 0) {
        this.db.aiAgents = buckets.aiAgents.map((agent: AIAgentConfig) =>
          typeof agent?.model === 'string' && agent.model.startsWith('gemini-2.')
            ? { ...agent, model: 'gemini-4-hydrogen' }
            : agent
        );
      }
      if (Array.isArray(buckets.services)) this.db.services = buckets.services;
      if (Array.isArray(buckets.crmStages) && buckets.crmStages.length > 0) {
        this.db.crmStages = buckets.crmStages;
      }
      if (Array.isArray(buckets.projectStages) && buckets.projectStages.length > 0) {
        this.db.projectStages = buckets.projectStages;
      }
    }

    if (Array.isArray(buckets.integrationsConfig) && buckets.integrationsConfig[0]) {
      const cfg = buckets.integrationsConfig[0];
      const cur = this.db.integrations;
      const vault = decryptVaultPayload(cfg.encryptedVault);

      if (cfg.metaCloud && typeof cfg.metaCloud === 'object') {
        // Preserve backend-only Meta secrets strictly on the server (never overwrite with empty cloud values)
        const curMetaToken = cur.metaCloud.accessToken?.trim() || '';
        const curVerifyToken = cur.metaCloud.webhookVerifyToken?.trim() || '';

        const phoneNumberId =
          onlyFillMissing && cur.metaCloud.phoneNumberId?.trim()
            ? cur.metaCloud.phoneNumberId
            : typeof cfg.metaCloud.phoneNumberId === 'string'
            ? cfg.metaCloud.phoneNumberId
            : cur.metaCloud.phoneNumberId;
        const wabaId =
          onlyFillMissing && cur.metaCloud.wabaId?.trim()
            ? cur.metaCloud.wabaId
            : typeof cfg.metaCloud.wabaId === 'string'
            ? cfg.metaCloud.wabaId
            : cur.metaCloud.wabaId;

        const configured = Boolean(phoneNumberId.trim() && curMetaToken);
        const enabled =
          onlyFillMissing && curMetaToken
            ? cur.metaCloud.enabled && configured
            : Boolean(cfg.metaCloud.enabled) && configured;
        cur.metaCloud = {
          ...cur.metaCloud,
          phoneNumberId,
          wabaId,
          webhookUrl: OFFICIAL_PHP_WEBHOOK_URL,
          accessToken: curMetaToken,
          webhookVerifyToken: curVerifyToken,
          enabled,
          status: configured ? (enabled && cur.metaCloud.status === 'conectado' ? 'conectado' : 'desconectado') : 'nao_configurado'
        };
      }

      if (cfg.googlePlaces && typeof cfg.googlePlaces === 'object') {
        const curPlacesKey = cur.googlePlaces.apiKey?.trim() || '';
        const cloudPlacesKey = (vault.googlePlacesApiKey || '').trim();
        const nextPlacesKey = onlyFillMissing
          ? curPlacesKey || cloudPlacesKey || getEnvPlacesKey()
          : cloudPlacesKey || curPlacesKey || getEnvPlacesKey();
        const configured = Boolean(nextPlacesKey);
        const enabled =
          onlyFillMissing && curPlacesKey
            ? cur.googlePlaces.enabled && configured
            : Boolean(cfg.googlePlaces.enabled) && configured;
        cur.googlePlaces = {
          ...cur.googlePlaces,
          apiKey: nextPlacesKey,
          enabled,
          status: configured ? (enabled ? 'conectado' : 'desconectado') : 'nao_configurado'
        };
      }

      if (cfg.asaas && typeof cfg.asaas === 'object') {
        const curAsaasKey = cur.asaas.apiKey?.trim() || '';
        const cloudAsaasKey = (vault.asaasApiKey || '').trim();
        const curWebhookSecret = cur.asaas.webhookSecret?.trim() || '';
        const cloudWebhookSecret = (vault.asaasWebhookSecret || '').trim();

        const nextAsaasKey = onlyFillMissing
          ? curAsaasKey || cloudAsaasKey
          : cloudAsaasKey || curAsaasKey;
        const nextWebhookSecret = onlyFillMissing
          ? curWebhookSecret || cloudWebhookSecret
          : cloudWebhookSecret || curWebhookSecret;

        const configured = Boolean(nextAsaasKey);
        const enabled =
          onlyFillMissing && curAsaasKey
            ? cur.asaas.enabled && configured
            : Boolean(cfg.asaas.enabled) && configured;
        const env =
          onlyFillMissing && curAsaasKey
            ? cur.asaas.environment
            : cfg.asaas.environment === 'producao'
            ? 'producao'
            : 'sandbox';
        cur.asaas = {
          ...cur.asaas,
          apiKey: nextAsaasKey,
          webhookSecret: nextWebhookSecret,
          environment: env,
          enabled,
          status: configured ? (enabled ? 'conectado' : 'desconectado') : 'nao_configurado'
        };
      }

      if (!onlyFillMissing && cfg.gemini && typeof cfg.gemini === 'object') {
        const hasEnvKey = Boolean(
          process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
          process.env.GEMINI_API_KEY.trim().length > 5
        );
        const rawModel =
          typeof cfg.gemini.model === 'string' && cfg.gemini.model.trim()
            ? cfg.gemini.model.trim()
            : cur.gemini.model || 'gemini-3.8-flash';
        const nextModel = rawModel.startsWith('gemini-2.') ? 'gemini-3.8-flash' : rawModel;
        const nextQuota =
          typeof cfg.gemini.quotaLimit === 'number' &&
          Number.isFinite(cfg.gemini.quotaLimit) &&
          cfg.gemini.quotaLimit > 0
            ? Math.floor(cfg.gemini.quotaLimit)
            : cur.gemini.quotaLimit || 1500;
        const nextRequests =
          typeof cfg.gemini.requestsToday === 'number' &&
          Number.isFinite(cfg.gemini.requestsToday) &&
          cfg.gemini.requestsToday >= 0
            ? Math.floor(cfg.gemini.requestsToday)
            : cur.gemini.requestsToday;
        const nextEnabled = hasEnvKey ? Boolean(cfg.gemini.enabled) : false;

        cur.gemini = {
          ...cur.gemini,
          enabled: nextEnabled,
          model: nextModel,
          quotaLimit: nextQuota,
          requestsToday: nextRequests,
          status: !hasEnvKey ? 'nao_configurado' : nextEnabled ? 'conectado' : 'desconectado'
        };
      }
    }

    if (Array.isArray(users) && users.length > 0) {
      for (const incomingUser of users) {
        if (!incomingUser || !incomingUser.id || !incomingUser.email) continue;
        const validRole: StoredUser['role'] =
          incomingUser.role === 'admin' ||
          incomingUser.role === 'comercial' ||
          incomingUser.role === 'suporte' ||
          incomingUser.role === 'financeiro'
            ? incomingUser.role
            : 'comercial';

        const existingIdx = this.db.users.findIndex(
          (u) =>
            u.id === incomingUser.id ||
            u.email.toLowerCase() === String(incomingUser.email).toLowerCase()
        );

        if (existingIdx >= 0) {
          const existing = this.db.users[existingIdx];
          const incomingHash =
            typeof incomingUser.passwordHash === 'string' && incomingUser.passwordHash.trim().length >= 10
              ? incomingUser.passwordHash.trim()
              : undefined;

          if (onlyFillMissing) {
            const shouldRestoreAdminCreds =
              existing.id === 'usr_admin' &&
              incomingUser.id === 'usr_admin' &&
              !existing.passwordHash &&
              Boolean(incomingHash);
            const nextHash = existing.passwordHash || incomingHash;
            this.db.users[existingIdx] = {
              ...existing,
              ...(shouldRestoreAdminCreds
                ? {
                    name: String(incomingUser.name || existing.name),
                    email: String(incomingUser.email).trim().toLowerCase()
                  }
                : {}),
              ...(nextHash ? { passwordHash: nextHash } : {})
            };
          } else {
            const nextHash = incomingHash || existing.passwordHash;
            this.db.users[existingIdx] = {
              ...existing,
              name: String(incomingUser.name || existing.name),
              email: String(incomingUser.email).trim().toLowerCase(),
              role: existing.id === 'usr_admin' ? 'admin' : validRole,
              active: existing.id === 'usr_admin' ? true : Boolean(incomingUser.active ?? existing.active),
              ...(nextHash ? { passwordHash: nextHash } : {}),
              avatar:
                typeof incomingUser.avatar === 'string' && incomingUser.avatar
                  ? incomingUser.avatar
                  : existing.avatar
            };
          }
        } else {
          const incomingHash =
            typeof incomingUser.passwordHash === 'string' && incomingUser.passwordHash.trim().length >= 10
              ? incomingUser.passwordHash.trim()
              : undefined;
          this.db.users.push({
            id: String(incomingUser.id),
            name: String(incomingUser.name || incomingUser.email),
            email: String(incomingUser.email).trim().toLowerCase(),
            role: validRole,
            ...(incomingHash ? { passwordHash: incomingHash } : {}),
            avatar:
              typeof incomingUser.avatar === 'string' && incomingUser.avatar
                ? incomingUser.avatar
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(String(incomingUser.name || 'User'))}&background=D4A72C&color=090B10&bold=true`,
            active: Boolean(incomingUser.active ?? true),
            createdAt:
              typeof incomingUser.createdAt === 'string'
                ? incomingUser.createdAt
                : new Date().toISOString()
          });
        }
      }
    }

    this.saveToFile();
  }

  // Dashboard aggregated metrics
  public getDashboardMetrics() {
    const totalLeads = this.db.leads.length;
    const leadsByStatus = this.db.leads.reduce((acc, lead) => {
      acc[lead.status] = (acc[lead.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const activeClients = this.db.clients.filter((c) => c.status === 'ativo').length;
    const totalMRR = this.db.clients.reduce((acc, c) => acc + (c.mrr || 0), 0);

    const pipelineValue = this.db.leads
      .filter((l) => l.status !== 'perdido')
      .reduce((acc, l) => acc + (l.value || 0), 0);

    const wonValue = this.db.leads
      .filter((l) => l.status === 'ganho')
      .reduce((acc, l) => acc + (l.value || 0), 0);

    const openTickets = this.db.supportTickets.filter((t) => t.status !== 'resolvido').length;
    const activeProjects = this.db.projects.filter((p) => p.stage !== 'publicacao').length;
    const pendingProposals = this.db.proposals.filter((p) => p.status === 'aguardando_aprovacao').length;

    const totalRevenuePaid = this.db.financialTransactions
      .filter((t) => t.type === 'receita' && t.status === 'pago')
      .reduce((acc, t) => acc + t.value, 0);

    const pendingColdOutreach = this.db.leads.filter((l) => l.campaignStatus === 'pendente_aprovacao').length;

    return {
      totalLeads,
      leadsByStatus,
      activeClients,
      totalMRR,
      pipelineValue,
      wonValue,
      openTickets,
      activeProjects,
      pendingProposals,
      totalRevenuePaid,
      pendingColdOutreach,
      agentStats: {
        atendente: this.db.aiAgents.find((a) => a.id === 'atendente')?.stats,
        prospector: this.db.aiAgents.find((a) => a.id === 'prospector')?.stats
      }
    };
  }
}

export const storage = new StorageManager();
