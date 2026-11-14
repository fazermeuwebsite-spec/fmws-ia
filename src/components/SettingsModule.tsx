import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  CreditCard,
  Sparkles,
  CheckCircle2,
  Plus,
  Trash2,
  Edit3,
  MapPin,
  AlertCircle,
  KeyRound,
  UserPlus,
  ShieldCheck,
  X,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  Database,
  UploadCloud,
  DownloadCloud,
  Copy,
  Check,
  Globe,
  Lock,
  Activity,
  Cpu,
  Clock
} from 'lucide-react';
import { api } from '../services/api';
import {
  auth as firebaseAuth,
  firestoreProjectId,
  firestoreDatabaseId,
  signInFirebaseWithGoogle,
  syncSnapshotToFirestore,
  loadSnapshotFromFirestore
} from '../firebase';
import { SystemIntegrations, ServiceProduct, User, UserRole, WhatsAppIntegrationLog } from '../types';

const OFFICIAL_PHP_WEBHOOK_URL = 'https://crm.fazermeuwebsite.com.br/api/webhooks/whatsapp.php';

interface SettingsModuleProps {
  integrations: SystemIntegrations;
  services: ServiceProduct[];
  users: User[];
  currentUser: User;
  onUpdateIntegrations: (data: any) => Promise<void>;
  onIntegrationsUpdated?: (integrations: SystemIntegrations) => Promise<void> | void;
  onSaveService: (service: Partial<ServiceProduct>) => Promise<void>;
  onDeleteService: (id: string) => Promise<void>;
  onCreateUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    active?: boolean;
  }) => Promise<void>;
  onUpdateUser: (id: string, payload: Partial<User> & { password?: string }) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onCloudRestored?: () => Promise<void>;
  initialTab?: 'integrations' | 'gemini' | 'deepseek' | 'places' | 'services' | 'users';
  firebaseWorkspaceId?: string;
  firestoreWhatsAppLogs?: WhatsAppIntegrationLog[];
}

const STATUS_BADGE: Record<string, string> = {
  conectado: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  nao_configurado: 'bg-slate-800 text-slate-300 border border-slate-700',
  desconectado: 'bg-slate-800 text-slate-400 border border-slate-700',
  sandbox: 'bg-sky-500/20 text-sky-300 border border-sky-500/30',
  limite_atingido: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  sem_saldo: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  erro: 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
};

const STATUS_LABEL: Record<string, string> = {
  conectado: 'Conectado',
  nao_configurado: 'Não configurado',
  desconectado: 'Desconectado',
  sandbox: 'Sandbox',
  limite_atingido: 'Limite atingido',
  sem_saldo: 'Sem saldo',
  erro: 'Erro'
};

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  integrations,
  services,
  users,
  currentUser,
  onUpdateIntegrations,
  onIntegrationsUpdated,
  onSaveService,
  onDeleteService,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onCloudRestored,
  initialTab,
  firebaseWorkspaceId = '',
  firestoreWhatsAppLogs = []
}) => {
  const [activeTab, setActiveTab] = useState<'integrations' | 'gemini' | 'deepseek' | 'places' | 'services' | 'users'>(
    initialTab || 'integrations'
  );

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const dirtySectionsRef = React.useRef({
    meta: false,
    places: false,
    asaas: false,
    gemini: false,
    deepseek: false
  });

  // Non-secret integration fields
  const [metaEnabled, setMetaEnabled] = useState(integrations.metaCloud.enabled);
  const [phoneNumberId, setPhoneNumberId] = useState(integrations.metaCloud.phoneNumberId);
  const [wabaId, setWabaId] = useState(integrations.metaCloud.wabaId);

  const [placesEnabled, setPlacesEnabled] = useState(integrations.googlePlaces.enabled);
  const [showPlacesKey, setShowPlacesKey] = useState(false);
  const [testingPlaces, setTestingPlaces] = useState(false);

  const [asaasEnabled, setAsaasEnabled] = useState(integrations.asaas.enabled);
  const [asaasEnv, setAsaasEnv] = useState(integrations.asaas.environment);

  const [geminiEnabled, setGeminiEnabled] = useState(integrations.gemini.enabled);
  const [geminiModel, setGeminiModel] = useState(integrations.gemini.model || 'gemini-4-hydrogen');
  const [geminiQuotaLimit, setGeminiQuotaLimit] = useState(String(integrations.gemini.quotaLimit || 1500));
  const [syncAgentsModel, setSyncAgentsModel] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiLastLatencyMs, setGeminiLastLatencyMs] = useState<number | null>(null);

  // DeepSeek API state
  const [deepseekEnabled, setDeepseekEnabled] = useState(Boolean(integrations.deepseek?.enabled));
  const [deepseekBaseUrl, setDeepseekBaseUrl] = useState(integrations.deepseek?.baseUrl || 'https://api.deepseek.com');
  const [deepseekModel, setDeepseekModel] = useState(integrations.deepseek?.model || 'deepseek-flash');
  const [deepseekQuotaLimit, setDeepseekQuotaLimit] = useState(String(integrations.deepseek?.quotaLimit || 1500));
  const [deepseekTimeoutMs, setDeepseekTimeoutMs] = useState(String(integrations.deepseek?.timeoutMs || 25000));
  const [deepseekMaxTokens, setDeepseekMaxTokens] = useState(String(integrations.deepseek?.maxTokens || 1200));
  const [deepseekAvailableModels, setDeepseekAvailableModels] = useState<string[]>(
    integrations.deepseek?.availableModels?.length
      ? integrations.deepseek.availableModels
      : ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
  );
  const [deepseekApiKeyDraft, setDeepseekApiKeyDraft] = useState('');
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [syncDeepSeekAgentsModel, setSyncDeepSeekAgentsModel] = useState(false);
  const [testingDeepSeek, setTestingDeepSeek] = useState(false);
  const [loadingDeepSeekModels, setLoadingDeepSeekModels] = useState(false);
  const [deepseekLastLatencyMs, setDeepseekLastLatencyMs] = useState<number | null>(null);

  // Ephemeral secret input drafts (never pre-populated from server!)
  const [metaAccessTokenDraft, setMetaAccessTokenDraft] = useState('');
  const [metaVerifyTokenDraft, setMetaVerifyTokenDraft] = useState('');
  const [metaAppSecretDraft, setMetaAppSecretDraft] = useState('');
  const [metaBridgeSecretDraft, setMetaBridgeSecretDraft] = useState('');
  const [generatedBridgeSecretOnce, setGeneratedBridgeSecretOnce] = useState<string | null>(null);
  const [placesApiKeyDraft, setPlacesApiKeyDraft] = useState('');
  const [asaasApiKeyDraft, setAsaasApiKeyDraft] = useState('');
  const [asaasWebhookSecretDraft, setAsaasWebhookSecretDraft] = useState('');

  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!dirtySectionsRef.current.meta) {
      setMetaEnabled(integrations.metaCloud.enabled);
      setPhoneNumberId(integrations.metaCloud.phoneNumberId);
      setWabaId(integrations.metaCloud.wabaId);
    }
    if (!dirtySectionsRef.current.places) {
      setPlacesEnabled(integrations.googlePlaces.enabled);
    }
    if (!dirtySectionsRef.current.asaas) {
      setAsaasEnabled(integrations.asaas.enabled);
      setAsaasEnv(integrations.asaas.environment);
    }
    if (!dirtySectionsRef.current.gemini) {
      setGeminiEnabled(integrations.gemini.enabled);
      setGeminiModel(integrations.gemini.model || 'gemini-4-hydrogen');
      setGeminiQuotaLimit(String(integrations.gemini.quotaLimit || 1500));
    }
    if (!dirtySectionsRef.current.deepseek && integrations.deepseek) {
      setDeepseekEnabled(Boolean(integrations.deepseek.enabled));
      setDeepseekBaseUrl(integrations.deepseek.baseUrl || 'https://api.deepseek.com');
      setDeepseekModel(integrations.deepseek.model || 'deepseek-flash');
      setDeepseekQuotaLimit(String(integrations.deepseek.quotaLimit || 1500));
      setDeepseekTimeoutMs(String(integrations.deepseek.timeoutMs || 25000));
      setDeepseekMaxTokens(String(integrations.deepseek.maxTokens || 1200));
      if (Array.isArray(integrations.deepseek.availableModels) && integrations.deepseek.availableModels.length > 0) {
        setDeepseekAvailableModels(integrations.deepseek.availableModels);
      }
    }
  }, [integrations]);

  // Service form state
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [serviceDesc, setServiceDesc] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceCycle, setServiceCycle] = useState<'unico' | 'mensal' | 'anual'>('unico');
  const [serviceFeaturesText, setServiceFeaturesText] = useState('');
  const [savingService, setSavingService] = useState(false);

  // User form state
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('comercial');
  const [savingUser, setSavingUser] = useState(false);
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [savingUserAction, setSavingUserAction] = useState(false);

  const officialWebhookUrl = integrations.metaCloud.webhookUrl || OFFICIAL_PHP_WEBHOOK_URL;
  const [showMetaAccessToken, setShowMetaAccessToken] = useState(false);
  const [showMetaVerifyToken, setShowMetaVerifyToken] = useState(false);
  const [showMetaAppSecret, setShowMetaAppSecret] = useState(false);
  const [testingMetaWebhook, setTestingMetaWebhook] = useState(false);
  const [testingMetaConnection, setTestingMetaConnection] = useState(false);
  const [generatingBridgeSecret, setGeneratingBridgeSecret] = useState(false);
  const [metaWebhookDiag, setMetaWebhookDiag] = useState<{
    status: 'ok' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<
    'webhookUrl' | 'verifyToken' | 'bridgeSecret' | 'bridgeUrl' | 'workspaceId' | 'projectId' | 'databaseId' | null
  >(null);
  const [subscribingWaba, setSubscribingWaba] = useState(false);
  const [metaApiDiag, setMetaApiDiag] = useState<{
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
  } | null>(null);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppIntegrationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const mergedWhatsappLogs = React.useMemo(() => {
    const byId = new Map<string, WhatsAppIntegrationLog>();
    for (const lg of whatsappLogs) {
      if (lg?.id) byId.set(lg.id, lg);
    }
    for (const lg of firestoreWhatsAppLogs) {
      if (lg?.id && !byId.has(lg.id)) byId.set(lg.id, lg);
    }
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      .slice(0, 100);
  }, [whatsappLogs, firestoreWhatsAppLogs]);

  const loadWhatsAppLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await api.getWhatsAppLogs();
      setWhatsappLogs(res.logs || []);
    } catch {
      // ignore transient log fetch errors
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'integrations') {
      void loadWhatsAppLogs();
    }
  }, [activeTab]);

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      const payload: any = {
        metaCloud: {
          enabled: metaEnabled,
          phoneNumberId: phoneNumberId.trim(),
          wabaId: wabaId.trim(),
          ...(metaAccessTokenDraft.trim() ? { accessToken: metaAccessTokenDraft.trim() } : {}),
          ...(metaVerifyTokenDraft.trim() ? { webhookVerifyToken: metaVerifyTokenDraft.trim() } : {}),
          ...(metaAppSecretDraft.trim() ? { appSecret: metaAppSecretDraft.trim() } : {}),
          ...(metaBridgeSecretDraft.trim() ? { bridgeSecret: metaBridgeSecretDraft.trim() } : {})
        },
        googlePlaces: {
          enabled: placesEnabled,
          ...(placesApiKeyDraft.trim() ? { apiKey: placesApiKeyDraft.trim() } : {})
        },
        asaas: {
          enabled: asaasEnabled,
          environment: asaasEnv,
          ...(asaasApiKeyDraft.trim() ? { apiKey: asaasApiKeyDraft.trim() } : {}),
          ...(asaasWebhookSecretDraft.trim()
            ? { webhookSecret: asaasWebhookSecretDraft.trim() }
            : {})
        },
        gemini: {
          enabled: geminiEnabled,
          model: geminiModel,
          quotaLimit: Math.max(10, parseInt(geminiQuotaLimit, 10) || 1500),
          syncAgents: syncAgentsModel
        },
        deepseek: {
          enabled: deepseekEnabled,
          baseUrl: deepseekBaseUrl.trim() || 'https://api.deepseek.com',
          model: deepseekModel.trim() || 'deepseek-flash',
          quotaLimit: Math.max(10, parseInt(deepseekQuotaLimit, 10) || 1500),
          timeoutMs: Math.max(2000, parseInt(deepseekTimeoutMs, 10) || 25000),
          maxTokens: Math.max(64, parseInt(deepseekMaxTokens, 10) || 1200),
          ...(deepseekApiKeyDraft.trim() ? { apiKey: deepseekApiKeyDraft.trim() } : {}),
          syncAgents: syncDeepSeekAgentsModel
        }
      };

      dirtySectionsRef.current = { meta: false, places: false, asaas: false, gemini: false, deepseek: false };
      await onUpdateIntegrations(payload);
      setMetaAccessTokenDraft('');
      setMetaVerifyTokenDraft('');
      setMetaAppSecretDraft('');
      setMetaBridgeSecretDraft('');
      setPlacesApiKeyDraft('');
      setAsaasApiKeyDraft('');
      setAsaasWebhookSecretDraft('');
      setDeepseekApiKeyDraft('');
      setFeedback({
        type: 'success',
        text: 'Configurações salvas no servidor. Nenhuma credencial sensível é exposta ao navegador.'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar integrações.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleClearSecret = async (section: 'metaCloud' | 'googlePlaces' | 'asaas' | 'deepseek', field: string) => {
    setFeedback(null);
    try {
      await onUpdateIntegrations({
        [section]: {
          [field]: '__CLEAR__',
          ...(section === 'googlePlaces' || section === 'deepseek' ? { enabled: false } : {})
        }
      });
      if (section === 'googlePlaces') {
        dirtySectionsRef.current.places = false;
        setPlacesApiKeyDraft('');
        setPlacesEnabled(false);
      }
      if (section === 'deepseek') {
        dirtySectionsRef.current.deepseek = false;
        setDeepseekApiKeyDraft('');
        setDeepseekEnabled(false);
      }
      if (field === 'bridgeSecret') {
        setGeneratedBridgeSecretOnce(null);
        setMetaBridgeSecretDraft('');
      }
      setFeedback({ type: 'success', text: 'Credencial removida do servidor.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao remover credencial.' });
    }
  };

  const handleCopyText = async (
    field: 'webhookUrl' | 'verifyToken' | 'bridgeSecret' | 'bridgeUrl' | 'workspaceId' | 'projectId' | 'databaseId',
    value: string
  ) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors in restricted frames
    }
  };

  const handleGenerateVerifyToken = () => {
    const rand = Math.random().toString(36).slice(2, 10);
    const stamp = Date.now().toString(36).slice(-4);
    setMetaVerifyTokenDraft(`fmws_wh_${rand}${stamp}`);
    setShowMetaVerifyToken(true);
    setMetaWebhookDiag(null);
  };

  const handleGenerateBridgeSecret = async () => {
    setFeedback(null);
    setGeneratingBridgeSecret(true);
    try {
      const res = await api.generateBridgeSecret();
      setGeneratedBridgeSecretOnce(res.bridgeSecret);
      setMetaBridgeSecretDraft('');
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      }
      await loadWhatsAppLogs();
      setFeedback({
        type: 'success',
        text: 'Bridge Secret gerado e salvo no servidor. Copie-o agora para o whatsapp.php (não será exibido novamente após sair da tela).'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao gerar Bridge Secret.' });
    } finally {
      setGeneratingBridgeSecret(false);
    }
  };

  const handleSaveMetaCloudOnly = async () => {
    setFeedback(null);
    setMetaWebhookDiag(null);
    setSavingIntegrations(true);
    try {
      dirtySectionsRef.current.meta = false;
      await onUpdateIntegrations({
        metaCloud: {
          enabled: metaEnabled,
          phoneNumberId: phoneNumberId.trim(),
          wabaId: wabaId.trim(),
          ...(metaAccessTokenDraft.trim() ? { accessToken: metaAccessTokenDraft.trim() } : {}),
          ...(metaVerifyTokenDraft.trim() ? { webhookVerifyToken: metaVerifyTokenDraft.trim() } : {}),
          ...(metaAppSecretDraft.trim() ? { appSecret: metaAppSecretDraft.trim() } : {}),
          ...(metaBridgeSecretDraft.trim() ? { bridgeSecret: metaBridgeSecretDraft.trim() } : {})
        }
      });
      setMetaAccessTokenDraft('');
      setMetaVerifyTokenDraft('');
      setMetaAppSecretDraft('');
      setMetaBridgeSecretDraft('');
      setFeedback({
        type: 'success',
        text: 'Credenciais salvas no backend. Clique em "Testar Conexão" e "Verificar Webhook" para validar em tempo real.'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar WhatsApp Cloud API.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleTestMetaConnection = async () => {
    setFeedback(null);
    setTestingMetaConnection(true);
    try {
      const res = await api.testMetaConnection({
        enabled: metaEnabled,
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim(),
        accessToken: metaAccessTokenDraft.trim() || undefined,
        verifyToken: metaVerifyTokenDraft.trim() || undefined,
        appSecret: metaAppSecretDraft.trim() || undefined
      });
      setMetaAccessTokenDraft('');
      setMetaVerifyTokenDraft('');
      setMetaAppSecretDraft('');
      dirtySectionsRef.current.meta = false;
      setMetaApiDiag({
        phoneOk: res.phoneOk,
        phoneInfo: res.phoneInfo,
        phoneError: res.phoneError,
        wabaSubscribed: res.wabaSubscribed,
        subscribedApps: res.subscribedApps,
        wabaError: res.wabaError
      });
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      }
      await loadWhatsAppLogs();
      setFeedback({
        type: 'success',
        text: res.message || 'Conexão com a Meta Cloud API validada!'
      });
    } catch (err: any) {
      await loadWhatsAppLogs();
      setMetaApiDiag({
        phoneOk: false,
        phoneError: err?.message || 'Falha ao validar conexão Meta Cloud API.'
      });
      setFeedback({
        type: 'error',
        text: err?.message || 'Falha ao validar conexão com a Meta Cloud API.'
      });
    } finally {
      setTestingMetaConnection(false);
    }
  };

  const handleVerifyPhpWebhook = async () => {
    setFeedback(null);
    setMetaWebhookDiag(null);
    setTestingMetaWebhook(true);
    try {
      const res = await api.verifyPhpWebhook({
        verifyToken: metaVerifyTokenDraft.trim() || undefined
      });
      setMetaVerifyTokenDraft('');
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      }
      await loadWhatsAppLogs();
      setMetaWebhookDiag({
        status: 'ok',
        text: res.message || `Webhook PHP validado com HTTP ${res.httpStatus}!`
      });
      setFeedback({
        type: 'success',
        text: res.message || 'Webhook PHP oficial verificado com sucesso!'
      });
    } catch (err: any) {
      await loadWhatsAppLogs();
      const msg = err?.message || 'Falha ao verificar o webhook PHP oficial.';
      setMetaWebhookDiag({ status: 'error', text: msg });
      setFeedback({ type: 'error', text: msg });
    } finally {
      setTestingMetaWebhook(false);
    }
  };

  const handleSubscribeWaba = async () => {
    setFeedback(null);
    setSubscribingWaba(true);
    try {
      await api.subscribeMetaWaba();
      setFeedback({ type: 'success', text: 'App inscrito com sucesso no WABA para receber eventos do WhatsApp!' });
      await handleTestMetaConnection();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao inscrever app no WABA.' });
    } finally {
      setSubscribingWaba(false);
    }
  };

  const handleSaveGooglePlacesOnly = async () => {
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      dirtySectionsRef.current.places = false;
      await onUpdateIntegrations({
        googlePlaces: {
          enabled: placesEnabled,
          ...(placesApiKeyDraft.trim() ? { apiKey: placesApiKeyDraft.trim() } : {})
        }
      });
      setPlacesApiKeyDraft('');
      setFeedback({
        type: 'success',
        text: 'Configuração do Google Places salva no servidor!'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar Google Places.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleTestGooglePlaces = async () => {
    setFeedback(null);
    setTestingPlaces(true);
    try {
      dirtySectionsRef.current.places = false;
      const res = await api.testGooglePlaces(placesApiKeyDraft.trim() || undefined);
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      } else {
        await onUpdateIntegrations({});
      }
      setPlacesApiKeyDraft('');
      setPlacesEnabled(true);
      setFeedback({
        type: 'success',
        text: res.message || 'Google Places API (New) validada e conectada com sucesso!'
      });
    } catch (err: any) {
      await onUpdateIntegrations({});
      setFeedback({
        type: 'error',
        text: err.message || 'Não foi possível validar a API Key do Google Places.'
      });
    } finally {
      setTestingPlaces(false);
    }
  };

  const handleSaveGeminiOnly = async () => {
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      dirtySectionsRef.current.gemini = false;
      await onUpdateIntegrations({
        gemini: {
          enabled: geminiEnabled,
          model: geminiModel,
          quotaLimit: Math.max(10, parseInt(geminiQuotaLimit, 10) || 1500),
          syncAgents: syncAgentsModel
        }
      });
      setFeedback({
        type: 'success',
        text: `Configurações da API Gemini salvas (${geminiModel})${syncAgentsModel ? ' e aplicadas aos agentes Gemini' : ''}.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configurações da API Gemini.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleResetGeminiCounter = async () => {
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      await onUpdateIntegrations({
        gemini: {
          requestsToday: 0,
          status: geminiEnabled ? 'conectado' : 'desconectado'
        }
      });
      setFeedback({
        type: 'success',
        text: 'Contador diário de requisições Gemini zerado com sucesso.'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao zerar contador do Gemini.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleTestGemini = async () => {
    setFeedback(null);
    setTestingGemini(true);
    try {
      dirtySectionsRef.current.gemini = false;
      const res = await api.testGemini(geminiModel);
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      } else {
        await onUpdateIntegrations({});
      }
      if (typeof res.latencyMs === 'number') {
        setGeminiLastLatencyMs(res.latencyMs);
      }
      setGeminiEnabled(true);
      setFeedback({
        type: 'success',
        text: res.message || `API Gemini (${geminiModel}) validada e conectada com sucesso!`
      });
    } catch (err: any) {
      await onUpdateIntegrations({});
      setFeedback({
        type: 'error',
        text: err.message || 'Não foi possível validar a conexão com a API Gemini no servidor.'
      });
    } finally {
      setTestingGemini(false);
    }
  };

  const handleSaveDeepSeekApiKeyOnly = async () => {
    const trimmedKey = deepseekApiKeyDraft.trim();
    if (!trimmedKey) {
      setFeedback({ type: 'error', text: 'Digite uma DeepSeek API Key válida antes de salvar.' });
      return;
    }
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      dirtySectionsRef.current.deepseek = false;
      await onUpdateIntegrations({
        deepseek: {
          apiKey: trimmedKey,
          baseUrl: deepseekBaseUrl.trim() || 'https://api.deepseek.com',
          enabled: deepseekEnabled || true
        }
      });
      setDeepseekApiKeyDraft('');
      setDeepseekEnabled(true);
      setFeedback({
        type: 'success',
        text: 'DeepSeek API Key criptografada e salva com segurança no servidor! Agora clique em "Testar Conexão" ou "Atualizar Modelos".'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao salvar DeepSeek API Key.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleSaveDeepSeekOnly = async () => {
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      dirtySectionsRef.current.deepseek = false;
      await onUpdateIntegrations({
        deepseek: {
          enabled: deepseekEnabled,
          baseUrl: deepseekBaseUrl.trim() || 'https://api.deepseek.com',
          model: deepseekModel.trim() || 'deepseek-flash',
          quotaLimit: Math.max(10, parseInt(deepseekQuotaLimit, 10) || 1500),
          timeoutMs: Math.max(2000, parseInt(deepseekTimeoutMs, 10) || 25000),
          maxTokens: Math.max(64, parseInt(deepseekMaxTokens, 10) || 1200),
          ...(deepseekApiKeyDraft.trim() ? { apiKey: deepseekApiKeyDraft.trim() } : {}),
          syncAgents: syncDeepSeekAgentsModel
        }
      });
      setDeepseekApiKeyDraft('');
      setFeedback({
        type: 'success',
        text: `Configurações da API DeepSeek salvas no servidor (${deepseekModel})${syncDeepSeekAgentsModel ? ' e aplicadas aos agentes DeepSeek' : ''}.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao salvar configurações da API DeepSeek.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleRefreshDeepSeekModels = async () => {
    setFeedback(null);
    setLoadingDeepSeekModels(true);
    try {
      const res = await api.fetchDeepSeekModels({
        apiKey: deepseekApiKeyDraft.trim() || undefined,
        baseUrl: deepseekBaseUrl.trim() || 'https://api.deepseek.com'
      });
      if (Array.isArray(res.models) && res.models.length > 0) {
        setDeepseekAvailableModels(res.models);
        if (!res.models.includes(deepseekModel)) {
          setDeepseekModel(res.models[0]);
        }
      }
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      }
      if (res.ok) {
        setFeedback({
          type: 'success',
          text: `Catálogo atualizado via GET /models (${res.liveModels.length} modelo(s) retornado(s) pela API + opções iniciais).`
        });
      } else {
        setFeedback({
          type: 'error',
          text: res.error || 'Não foi possível consultar GET /models dinamicamente. Opções padrão mantidas.'
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao carregar modelos DeepSeek.' });
    } finally {
      setLoadingDeepSeekModels(false);
    }
  };

  const handleResetDeepSeekCounter = async () => {
    setFeedback(null);
    setSavingIntegrations(true);
    try {
      await onUpdateIntegrations({
        deepseek: {
          requestsToday: 0,
          tokensUsedToday: 0,
          status: deepseekEnabled && integrations.deepseek?.hasApiKey ? 'conectado' : 'desconectado'
        }
      });
      setFeedback({
        type: 'success',
        text: 'Contadores diários de requisições e tokens da DeepSeek zerados com sucesso.'
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao zerar contadores da DeepSeek.' });
    } finally {
      setSavingIntegrations(false);
    }
  };

  const handleTestDeepSeek = async () => {
    setFeedback(null);
    setTestingDeepSeek(true);
    try {
      dirtySectionsRef.current.deepseek = false;
      const res = await api.testDeepSeek({
        apiKey: deepseekApiKeyDraft.trim() || undefined,
        baseUrl: deepseekBaseUrl.trim() || 'https://api.deepseek.com',
        model: deepseekModel.trim() || 'deepseek-flash',
        timeoutMs: Math.max(2000, parseInt(deepseekTimeoutMs, 10) || 25000),
        maxTokens: Math.max(64, parseInt(deepseekMaxTokens, 10) || 1200),
        quotaLimit: Math.max(10, parseInt(deepseekQuotaLimit, 10) || 1500),
        enabled: true,
        saveCredentials: true
      });
      setDeepseekApiKeyDraft('');
      if (Array.isArray(res.models) && res.models.length > 0) {
        setDeepseekAvailableModels(res.models);
      }
      if (res.integrations) {
        await onIntegrationsUpdated?.(res.integrations);
      }
      if (typeof res.latencyMs === 'number') {
        setDeepseekLastLatencyMs(res.latencyMs);
      }
      setDeepseekEnabled(true);
      setFeedback({
        type: 'success',
        text: res.message || `API DeepSeek (${deepseekModel}) validada e conectada com sucesso!`
      });
    } catch (err: any) {
      try {
        const latest = await api.getIntegrations();
        await onIntegrationsUpdated?.(latest);
      } catch {
        // ignore refresh error
      }
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível validar a conexão com a API DeepSeek.'
      });
    } finally {
      setTestingDeepSeek(false);
    }
  };

  const handleSyncToFirestore = async () => {
    setFeedback(null);
    setCloudSyncing(true);
    try {
      const fbUser = firebaseAuth.currentUser || (await signInFirebaseWithGoogle());
      try {
        const idToken = await fbUser.getIdToken();
        await api.linkGoogleAccount(idToken);
      } catch {
        // ignore if already linked or transient
      }
      const snapshot = await api.exportCloudSnapshot();
      const result = await syncSnapshotToFirestore(snapshot);
      setFeedback({
        type: 'success',
        text: `Backup salvo no Firestore (${result.usersSynced} usuários e ${result.bucketsSynced} coleções sincronizadas).`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err.message || 'Falha ao sincronizar com o Firestore.'
      });
    } finally {
      setCloudSyncing(false);
    }
  };

  const handleRestoreFromFirestore = async () => {
    setFeedback(null);
    setCloudSyncing(true);
    try {
      if (!firebaseAuth.currentUser) {
        await signInFirebaseWithGoogle();
      }
      const snapshot = await loadSnapshotFromFirestore();
      await api.restoreCloudSnapshot(snapshot.buckets, snapshot.users);
      if (onCloudRestored) {
        await onCloudRestored();
      }
      setFeedback({
        type: 'success',
        text: 'Coleções, equipe e configurações do CRM restauradas do Firestore com sucesso!'
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err.message || 'Falha ao restaurar dados do Firestore.'
      });
    } finally {
      setCloudSyncing(false);
    }
  };

  const resetServiceForm = () => {
    setEditingServiceId(null);
    setServiceName('');
    setServiceDesc('');
    setServicePrice('');
    setServiceCycle('unico');
    setServiceFeaturesText('');
  };

  const handleStartEditService = (svc: ServiceProduct) => {
    setEditingServiceId(svc.id);
    setServiceName(svc.name);
    setServiceDesc(svc.description || '');
    setServicePrice(String(svc.basePrice));
    setServiceCycle(svc.billingCycle || (svc.isRecurring ? 'mensal' : 'unico'));
    setServiceFeaturesText((svc.features || []).join(', '));
  };

  const handleSubmitService = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!serviceName.trim() || !servicePrice) return;
    setSavingService(true);
    try {
      const features = serviceFeaturesText
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      await onSaveService({
        ...(editingServiceId ? { id: editingServiceId } : {}),
        name: serviceName.trim(),
        description: serviceDesc.trim(),
        basePrice: parseFloat(servicePrice) || 0,
        isRecurring: serviceCycle !== 'unico',
        billingCycle: serviceCycle,
        category: serviceCycle === 'unico' ? 'desenvolvimento' : 'recorrente',
        features
      });
      resetServiceForm();
      setFeedback({ type: 'success', text: 'Serviço salvo na tabela comercial!' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao salvar serviço.' });
    } finally {
      setSavingService(false);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingUser(true);
    try {
      await onCreateUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole,
        active: true
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('comercial');
      setFeedback({ type: 'success', text: 'Usuário cadastrado e habilitado com sucesso.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao cadastrar usuário.' });
    } finally {
      setSavingUser(false);
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    setFeedback(null);
    if (!resetPwdValue || resetPwdValue.length < 6) {
      setFeedback({ type: 'error', text: 'A nova senha deve ter no mínimo 6 caracteres.' });
      return;
    }
    setSavingUserAction(true);
    try {
      await onUpdateUser(userId, { password: resetPwdValue });
      setResetPwdUserId(null);
      setResetPwdValue('');
      setFeedback({ type: 'success', text: 'Senha do usuário redefinida e salva no banco de dados.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao redefinir senha.' });
    } finally {
      setSavingUserAction(false);
    }
  };

  const handleSaveUserIdentity = async (userId: string) => {
    setFeedback(null);
    if (!editUserName.trim() || !editUserEmail.includes('@')) {
      setFeedback({ type: 'error', text: 'Informe um nome e um e-mail corporativo válidos.' });
      return;
    }
    setSavingUserAction(true);
    try {
      await onUpdateUser(userId, {
        name: editUserName.trim(),
        email: editUserEmail.trim().toLowerCase()
      });
      setEditUserId(null);
      setEditUserName('');
      setEditUserEmail('');
      setFeedback({ type: 'success', text: 'Nome e e-mail do usuário atualizados e salvos com sucesso!' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao atualizar dados do usuário.' });
    } finally {
      setSavingUserAction(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => { setActiveTab('integrations'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'integrations'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Integrações & APIs Oficiais
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('gemini'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'gemini'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles size={13} />
          <span>Google Gemini API</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('deepseek'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'deepseek'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Cpu size={13} />
          <span>DeepSeek API</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('places'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'places'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <MapPin size={13} />
          <span>Google Places API</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('services'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'services'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Tabela de Serviços & Preços ({services.length})
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('users'); setFeedback(null); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'users'
              ? 'bg-[#D4A72C] text-slate-950 font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Usuários & Permissões RBAC ({users.length})
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* TAB 1: INTEGRATIONS */}
      {activeTab === 'integrations' && (
        <form onSubmit={handleSaveIntegrations} className="space-y-5">
          {/* WhatsApp Cloud API (Meta + Webhook PHP Oficial) */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">WhatsApp Cloud API (Meta + Webhook PHP Oficial)</h3>
                  <p className="text-xs text-slate-400">
                    Credenciais armazenadas exclusivamente no servidor (nunca enviadas ao navegador ou Firestore público)
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {integrations.metaCloud.lastSyncedAt && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Última sincronização: {new Date(integrations.metaCloud.lastSyncedAt).toLocaleString('pt-BR')}
                  </span>
                )}
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={metaEnabled}
                    onChange={(e) => {
                      dirtySectionsRef.current.meta = true;
                      setMetaEnabled(e.target.checked);
                    }}
                    className="accent-[#D4A72C]"
                  />
                  <span>Ativar</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase ${STATUS_BADGE[integrations.metaCloud.status] || STATUS_BADGE.nao_configurado}`}>
                  {STATUS_LABEL[integrations.metaCloud.status] || integrations.metaCloud.status}
                </span>
              </div>
            </div>

            {integrations.metaCloud.connectedPhoneDisplay && (
              <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Número oficial conectado: <strong>{integrations.metaCloud.connectedPhoneDisplay}</strong>{' '}
                  {integrations.metaCloud.connectedVerifiedName ? `(${integrations.metaCloud.connectedVerifiedName})` : ''}
                </span>
                <span className="text-[10px] font-mono text-emerald-300">
                  Webhook PHP: {integrations.metaCloud.phpWebhookVerified ? 'Verificado (HTTP 200)' : 'Pendente verificação'}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={phoneNumberId}
                  onChange={(e) => {
                    dirtySectionsRef.current.meta = true;
                    setPhoneNumberId(e.target.value);
                  }}
                  placeholder="ID do número no Meta Business"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">WhatsApp Business Account ID (WABA ID)</label>
                <input
                  type="text"
                  value={wabaId}
                  onChange={(e) => {
                    dirtySectionsRef.current.meta = true;
                    setWabaId(e.target.value);
                  }}
                  placeholder="WhatsApp Business Account ID"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">Access Token da Meta</label>
                  {integrations.metaCloud.hasAccessToken && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('metaCloud', 'accessToken')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover salvo
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showMetaAccessToken ? 'text' : 'password'}
                    value={metaAccessTokenDraft}
                    onChange={(e) => setMetaAccessTokenDraft(e.target.value)}
                    placeholder={
                      integrations.metaCloud.hasAccessToken
                        ? `Token salvo (${integrations.metaCloud.accessTokenHint || '••••'}) — digite para atualizar`
                        : 'Cole o Access Token permanente'
                    }
                    className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 pr-9 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMetaAccessToken(!showMetaAccessToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showMetaAccessToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-slate-400 font-semibold">Verify Token do Webhook</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateVerifyToken}
                      className="text-[10px] text-[#D4A72C] hover:underline cursor-pointer font-semibold"
                    >
                      Gerar token
                    </button>
                    {integrations.metaCloud.hasWebhookVerifyToken && (
                      <button
                        type="button"
                        onClick={() => handleClearSecret('metaCloud', 'webhookVerifyToken')}
                        className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                      >
                        Remover salvo
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showMetaVerifyToken ? 'text' : 'password'}
                      value={metaVerifyTokenDraft}
                      onChange={(e) => setMetaVerifyTokenDraft(e.target.value)}
                      placeholder={
                        integrations.metaCloud.hasWebhookVerifyToken
                          ? `Verify Token salvo (${integrations.metaCloud.webhookVerifyTokenHint || '••••'}) — digite para substituir`
                          : 'Ex: fmws_wh_... (igual no Meta e whatsapp.php)'
                      }
                      className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 pr-9 text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMetaVerifyToken(!showMetaVerifyToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showMetaVerifyToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {metaVerifyTokenDraft.trim() && (
                    <button
                      type="button"
                      onClick={() => handleCopyText('verifyToken', metaVerifyTokenDraft.trim())}
                      title="Copiar Verify Token"
                      className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {copiedField === 'verifyToken' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      <span className="text-[10px] font-semibold">
                        {copiedField === 'verifyToken' ? 'Copiado' : 'Copiar'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">App Secret (Meta — Validação X-Hub-Signature-256)</label>
                  {integrations.metaCloud.hasAppSecret && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('metaCloud', 'appSecret')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover salvo
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showMetaAppSecret ? 'text' : 'password'}
                    value={metaAppSecretDraft}
                    onChange={(e) => setMetaAppSecretDraft(e.target.value)}
                    placeholder={
                      integrations.metaCloud.hasAppSecret
                        ? `App Secret salvo (${integrations.metaCloud.appSecretHint || '••••'}) — digite para atualizar`
                        : 'App Secret do painel Meta Developers > App Settings > Basic'
                    }
                    className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 pr-9 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMetaAppSecret(!showMetaAppSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showMetaAppSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-slate-400 font-semibold flex items-center gap-1">
                    <Lock size={12} className="text-[#D4A72C]" />
                    <span>Bridge Secret (PHP ↔ CRM HMAC-SHA256)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateBridgeSecret}
                      disabled={generatingBridgeSecret}
                      className="text-[10px] text-[#D4A72C] hover:underline cursor-pointer font-semibold disabled:opacity-40"
                    >
                      {generatingBridgeSecret ? 'Gerando...' : 'Gerar Bridge Secret'}
                    </button>
                    {integrations.metaCloud.hasBridgeSecret && (
                      <button
                        type="button"
                        onClick={() => handleClearSecret('metaCloud', 'bridgeSecret')}
                        className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="password"
                  value={metaBridgeSecretDraft}
                  onChange={(e) => setMetaBridgeSecretDraft(e.target.value)}
                  placeholder={
                    integrations.metaCloud.hasBridgeSecret
                      ? `Bridge Secret salvo (${integrations.metaCloud.bridgeSecretHint || '••••'}) — gere ou digite para substituir`
                      : 'Clique em "Gerar Bridge Secret" para autenticar o whatsapp.php'
                  }
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
                {generatedBridgeSecretOnce && (
                  <div className="mt-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] text-amber-300 font-bold">
                        Copie agora para o whatsapp.php (exibido apenas uma vez):
                      </div>
                      <code className="text-[11px] text-white font-mono break-all">{generatedBridgeSecretOnce}</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyText('bridgeSecret', generatedBridgeSecretOnce)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {copiedField === 'bridgeSecret' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      <span>{copiedField === 'bridgeSecret' ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-slate-400 font-semibold flex items-center gap-1.5">
                    <Globe size={13} className="text-[#D4A72C]" />
                    <span>URL do Webhook Oficial Existente (Hospedagem 20i — Somente Leitura)</span>
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    20i PHP + Gemini + Firestore (Sem Cloud Run)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    readOnly
                    value={officialWebhookUrl}
                    className="flex-1 bg-[#0B0E16] border border-slate-800 rounded-lg p-2 text-emerald-300 font-mono select-all cursor-default"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyText('webhookUrl', officialWebhookUrl)}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    {copiedField === 'webhookUrl' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedField === 'webhookUrl' ? 'Copiada!' : 'Copiar URL'}</span>
                  </button>
                </div>

                {/* Configuração direta 20i PHP -> Firestore (substitui Cloud Run bridge privado) */}
                <div className="mt-2 p-3 rounded-xl bg-[#0B0E16] border border-[#D4A72C]/30 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                      <Database size={13} className="text-[#D4A72C]" />
                      <span>Parâmetros Firestore para o <code className="text-[#D4A72C]">config.php</code> da 20i</span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                      Sem dependência de Cloud Run / ais-dev-*
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    O webhook PHP na hospedagem 20i processa as mensagens recebidas da Meta, consulta o <strong className="text-white">Atendente IA (Gemini)</strong> e grava tudo diretamente no <strong className="text-white">Firestore</strong>. Este painel recebe todas as conversas em tempo real pelos listeners do Firestore.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-semibold">FIREBASE_PROJECT_ID</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          readOnly
                          value={firestoreProjectId}
                          className="w-full bg-[#151926] border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 font-mono select-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyText('projectId', firestoreProjectId)}
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0 cursor-pointer"
                          title="Copiar FIREBASE_PROJECT_ID"
                        >
                          {copiedField === 'projectId' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-semibold">FIREBASE_DATABASE_ID</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          readOnly
                          value={firestoreDatabaseId}
                          className="w-full bg-[#151926] border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 font-mono select-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyText('databaseId', firestoreDatabaseId)}
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0 cursor-pointer"
                          title="Copiar FIREBASE_DATABASE_ID"
                        >
                          {copiedField === 'databaseId' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-semibold">FIREBASE_WORKSPACE_ID</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          readOnly
                          value={firebaseWorkspaceId || 'Conecte sua conta Google no topo'}
                          className={`w-full bg-[#151926] border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] font-mono select-all ${
                            firebaseWorkspaceId ? 'text-[#D4A72C]' : 'text-amber-300'
                          }`}
                        />
                        {firebaseWorkspaceId && (
                          <button
                            type="button"
                            onClick={() => handleCopyText('workspaceId', firebaseWorkspaceId)}
                            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0 cursor-pointer"
                            title="Copiar FIREBASE_WORKSPACE_ID"
                          >
                            {copiedField === 'workspaceId' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {metaWebhookDiag && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
                      metaWebhookDiag.status === 'ok'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : metaWebhookDiag.status === 'warning'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {metaWebhookDiag.status === 'ok' ? (
                      <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-300" />
                    )}
                    <span>{metaWebhookDiag.text}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTestMetaConnection}
                    disabled={testingMetaConnection}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <Activity size={12} className={testingMetaConnection ? 'animate-spin' : ''} />
                    <span>{testingMetaConnection ? 'Testando Conexão...' : 'Testar Conexão'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifyPhpWebhook}
                    disabled={testingMetaWebhook || (!metaVerifyTokenDraft.trim() && !integrations.metaCloud.hasWebhookVerifyToken)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={testingMetaWebhook ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                    <span>{testingMetaWebhook ? 'Verificando Webhook...' : 'Verificar Webhook'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMetaCloudOnly}
                    disabled={savingIntegrations}
                    className="px-3.5 py-1.5 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] hover:bg-[#D4A72C] hover:text-slate-950 font-bold cursor-pointer transition-colors disabled:opacity-40"
                  >
                    Salvar WhatsApp Cloud API
                  </button>
                </div>

                {metaApiDiag && (
                  <div className="mt-2 p-3 rounded-xl bg-[#0B0E16] border border-slate-800 space-y-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-white">Resultado do Teste na Meta Graph API</span>
                      {metaApiDiag.phoneOk ? (
                        <span className="text-emerald-400 font-semibold">
                          Número ativo: {metaApiDiag.phoneInfo?.displayPhoneNumber} ({metaApiDiag.phoneInfo?.verifiedName} • Qualidade {metaApiDiag.phoneInfo?.qualityRating || 'OK'})
                        </span>
                      ) : (
                        <span className="text-rose-400 font-semibold">
                          Erro no número/token: {metaApiDiag.phoneError}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                      <span>
                        Assinatura WABA (<code>subscribed_apps</code>):{' '}
                        {metaApiDiag.wabaSubscribed ? (
                          <strong className="text-emerald-400">
                            Inscrito ({metaApiDiag.subscribedApps?.map((a) => a.name || a.id).join(', ')})
                          </strong>
                        ) : (
                          <strong className="text-amber-300">
                            {metaApiDiag.wabaError || 'Não inscrito'}
                          </strong>
                        )}
                      </span>
                      {!metaApiDiag.wabaSubscribed && (
                        <button
                          type="button"
                          onClick={handleSubscribeWaba}
                          disabled={subscribingWaba}
                          className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold cursor-pointer disabled:opacity-40"
                        >
                          {subscribingWaba ? 'Inscrevendo...' : 'Inscrever App no WABA'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Sanitized Technical Logs Viewer */}
                <div className="mt-2 p-3 rounded-xl bg-[#0B0E16] border border-slate-800 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-200">
                      Logs Técnicos da Integração WhatsApp ({mergedWhatsappLogs.length})
                    </span>
                    <button
                      type="button"
                      onClick={loadWhatsAppLogs}
                      disabled={loadingLogs}
                      className="text-[10px] text-[#D4A72C] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw size={10} className={loadingLogs ? 'animate-spin' : ''} />
                      <span>Atualizar logs</span>
                    </button>
                  </div>
                  {mergedWhatsappLogs.length === 0 ? (
                    <div className="text-slate-500 italic text-[10px]">
                      Nenhum log registrado ainda. Execute "Testar Conexão", "Verificar Webhook" ou aguarde eventos do PHP no Firestore.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {mergedWhatsappLogs.slice(0, 30).map((log) => (
                        <div key={log.id} className="text-[10px] font-mono text-slate-300 flex items-center gap-2 py-0.5 border-b border-slate-900 last:border-b-0">
                          <span className="text-slate-500 shrink-0">
                            {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded uppercase shrink-0 font-bold ${
                              log.level === 'error'
                                ? 'bg-rose-500/20 text-rose-300'
                                : log.level === 'warning'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-[#D4A72C]'
                            }`}
                          >
                            {log.source}
                          </span>
                          <span className="truncate flex-1">{log.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Google Places API */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <MapPin size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Google Places API (New) — Prospecção</h3>
                  <p className="text-xs text-slate-400">
                    Utiliza a API oficial <code className="text-slate-300">Places API (New)</code> (<code className="text-slate-300">places.googleapis.com/v1</code>)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={placesEnabled}
                    onChange={(e) => {
                      dirtySectionsRef.current.places = true;
                      setPlacesEnabled(e.target.checked);
                    }}
                    className="accent-[#D4A72C]"
                  />
                  <span>Ativar</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase ${STATUS_BADGE[integrations.googlePlaces.status] || STATUS_BADGE.nao_configurado}`}>
                  {STATUS_LABEL[integrations.googlePlaces.status] || integrations.googlePlaces.status}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">API Key Google Places</label>
                  {integrations.googlePlaces.hasApiKey && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('googlePlaces', 'apiKey')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover chave salva
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPlacesKey ? 'text' : 'password'}
                    value={placesApiKeyDraft}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPlacesApiKeyDraft(val);
                      if (val.trim()) setPlacesEnabled(true);
                    }}
                    placeholder={
                      integrations.googlePlaces.hasApiKey
                        ? `Chave salva (${integrations.googlePlaces.apiKeyHint || '••••'}) — digite para substituir`
                        : 'Não configurado — cole sua API Key apenas se autorizada'
                    }
                    className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 pr-9 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPlacesKey(!showPlacesKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showPlacesKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestGooglePlaces}
                  disabled={testingPlaces || (!placesApiKeyDraft.trim() && !integrations.googlePlaces.hasApiKey)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw size={12} className={testingPlaces ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                  <span>{testingPlaces ? 'Testando API...' : 'Testar & Conectar Google Places'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveGooglePlacesOnly}
                  disabled={savingIntegrations}
                  className="px-3.5 py-1.5 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] hover:bg-[#D4A72C] hover:text-slate-950 font-bold cursor-pointer transition-colors"
                >
                  Salvar Google Places
                </button>
              </div>
            </div>
          </div>

          {/* Asaas Gateway */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <CreditCard size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Gateway de Pagamentos Asaas</h3>
                  <p className="text-xs text-slate-400">
                    Emissão de boletos, PIX e conciliação de faturas via webhook autenticado
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={asaasEnabled}
                    onChange={(e) => {
                      dirtySectionsRef.current.asaas = true;
                      setAsaasEnabled(e.target.checked);
                    }}
                    className="accent-[#D4A72C]"
                  />
                  <span>Ativar</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase ${STATUS_BADGE[integrations.asaas.status] || STATUS_BADGE.nao_configurado}`}>
                  {STATUS_LABEL[integrations.asaas.status] || integrations.asaas.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">API Key Asaas</label>
                  {integrations.asaas.hasApiKey && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('asaas', 'apiKey')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover salva
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={asaasApiKeyDraft}
                  onChange={(e) => setAsaasApiKeyDraft(e.target.value)}
                  placeholder={
                    integrations.asaas.hasApiKey
                      ? '•••••••• Salva no servidor (digite para substituir)'
                      : 'Cole a API Key Asaas'
                  }
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">Webhook Secret Token</label>
                  {integrations.asaas.hasWebhookSecret && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('asaas', 'webhookSecret')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover salvo
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={asaasWebhookSecretDraft}
                  onChange={(e) => setAsaasWebhookSecretDraft(e.target.value)}
                  placeholder={
                    integrations.asaas.hasWebhookSecret
                      ? '•••••••• Salvo no servidor'
                      : 'Token asaas-access-token'
                  }
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Ambiente de Operação</label>
                <select
                  value={asaasEnv}
                  onChange={(e) => {
                    dirtySectionsRef.current.asaas = true;
                    setAsaasEnv(e.target.value as 'sandbox' | 'producao');
                  }}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="sandbox">Sandbox (Testes)</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
            </div>
          </div>

          {/* Gemini AI Config & Quota Guard */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/10 text-[#D4A72C] flex items-center justify-center">
                  <Sparkles size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Google Gemini API — Inteligência Artificial</h3>
                  <p className="text-xs text-slate-400">
                    Autenticação server-side via <code className="text-[#D4A72C]">Settings &gt; Secrets</code> (<code className="text-slate-300">GEMINI_API_KEY</code>)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={geminiEnabled}
                    onChange={(e) => {
                      dirtySectionsRef.current.gemini = true;
                      setGeminiEnabled(e.target.checked);
                    }}
                    className="accent-[#D4A72C]"
                  />
                  <span>Ativar</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase ${STATUS_BADGE[integrations.gemini.status] || STATUS_BADGE.nao_configurado}`}>
                  {STATUS_LABEL[integrations.gemini.status] || integrations.gemini.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Modelo Gemini Padrão</label>
                <select
                  value={geminiModel}
                  onChange={(e) => {
                    dirtySectionsRef.current.gemini = true;
                    setGeminiModel(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                >
                  <option value="gemini-4-hydrogen">gemini-4-hydrogen (Padrão Recomendado)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Alta Velocidade)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Legado)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Limite Diário (Quota Guard)</label>
                <input
                  type="number"
                  min={10}
                  max={100000}
                  value={geminiQuotaLimit}
                  onChange={(e) => {
                    dirtySectionsRef.current.gemini = true;
                    setGeminiQuotaLimit(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Requisições executadas hoje:</span>
                <span className="font-mono text-white font-bold">
                  {integrations.gemini.requestsToday} / {integrations.gemini.quotaLimit} req/dia
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#D4A72C] h-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (integrations.gemini.requestsToday / Math.max(1, integrations.gemini.quotaLimit)) * 100
                    )}%`
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleTestGemini}
                disabled={testingGemini}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw size={12} className={testingGemini ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                <span>{testingGemini ? 'Testando Gemini...' : 'Testar Conexão Gemini'}</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('gemini'); setFeedback(null); }}
                className="px-3.5 py-1.5 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] hover:bg-[#D4A72C] hover:text-slate-950 text-xs font-bold cursor-pointer transition-colors"
              >
                Configuração Completa Gemini
              </button>
            </div>
          </div>

          {/* DeepSeek AI Summary Card */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/10 text-[#D4A72C] flex items-center justify-center">
                  <Cpu size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">DeepSeek API — Inteligência Artificial Alternativa</h3>
                  <p className="text-xs text-slate-400">
                    Chave armazenada criptografada exclusivamente no servidor (<code className="text-slate-300">enc:v1</code>), selecionável por agente autônomo
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deepseekEnabled}
                    onChange={(e) => {
                      dirtySectionsRef.current.deepseek = true;
                      setDeepseekEnabled(e.target.checked);
                    }}
                    className="accent-[#D4A72C]"
                  />
                  <span>Ativar</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded font-bold uppercase ${STATUS_BADGE[integrations.deepseek?.status || 'nao_configurado'] || STATUS_BADGE.nao_configurado}`}>
                  {STATUS_LABEL[integrations.deepseek?.status || 'nao_configurado'] || integrations.deepseek?.status || 'Não configurado'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold">DeepSeek API Key</label>
                  {integrations.deepseek?.hasApiKey && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('deepseek', 'apiKey')}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remover chave
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showDeepseekKey ? 'text' : 'password'}
                    value={deepseekApiKeyDraft}
                    onChange={(e) => {
                      dirtySectionsRef.current.deepseek = true;
                      setDeepseekApiKeyDraft(e.target.value);
                    }}
                    placeholder={
                      integrations.deepseek?.hasApiKey
                        ? `Chave salva (${integrations.deepseek.apiKeyHint || '••••'}) — digite para substituir`
                        : 'sk-... (salva apenas no servidor)'
                    }
                    className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 pr-9 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showDeepseekKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Modelo DeepSeek Padrão</label>
                <select
                  value={deepseekModel}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekModel(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                >
                  {deepseekAvailableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Base URL</label>
                <input
                  type="url"
                  value={deepseekBaseUrl}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekBaseUrl(e.target.value);
                  }}
                  placeholder="https://api.deepseek.com"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span>
                Uso hoje: <strong className="font-mono text-white">{integrations.deepseek?.requestsToday ?? 0} / {integrations.deepseek?.quotaLimit ?? 1500} req</strong>
              </span>
              <span>
                Tokens consumidos hoje: <strong className="font-mono text-[#D4A72C]">{(integrations.deepseek?.tokensUsedToday ?? 0).toLocaleString('pt-BR')} tokens</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleTestDeepSeek}
                disabled={testingDeepSeek}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw size={12} className={testingDeepSeek ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                <span>{testingDeepSeek ? 'Testando DeepSeek...' : 'Testar Conexão DeepSeek'}</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('deepseek'); setFeedback(null); }}
                className="px-3.5 py-1.5 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] hover:bg-[#D4A72C] hover:text-slate-950 text-xs font-bold cursor-pointer transition-colors"
              >
                Configuração Completa DeepSeek
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingIntegrations}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
          >
            {savingIntegrations ? 'Salvando no servidor...' : 'Salvar Configurações no Servidor'}
          </button>

          {/* Firestore Cloud Persistence & Sync (Starter Tier) */}
          <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <Database size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Persistência em Nuvem — Firebase Firestore (Conectado)</h3>
                  <p className="text-xs text-slate-400">
                    Projeto <code className="text-slate-300">{firestoreProjectId}</code> • Banco <code className="text-slate-300">{firestoreDatabaseId}</code>
                  </p>
                </div>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Firestore Conectado
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              No ambiente Cloud Run atual, o servidor armazena usuários (hash <code className="text-slate-300">bcrypt</code>), sessões e registros em <code className="text-slate-300">/data/db.json</code> (persistente entre reinicializações do processo, mas efêmero em novas publicações do container). Use os botões abaixo para sincronizar ou restaurar seus registros do CRM com segurança no Firestore via conta Google verificada.
            </p>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleSyncToFirestore}
                disabled={cloudSyncing}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <UploadCloud size={14} className="text-[#D4A72C]" />
                <span>{cloudSyncing ? 'Sincronizando...' : 'Sincronizar Backup para Firestore'}</span>
              </button>
              <button
                type="button"
                onClick={handleRestoreFromFirestore}
                disabled={cloudSyncing}
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <DownloadCloud size={14} className="text-emerald-400" />
                <span>Restaurar Coleções do Firestore</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: GOOGLE GEMINI API DEDICATED CONFIG */}
      {activeTab === 'gemini' && (
        <div className="space-y-4">
          <div className="p-6 rounded-xl bg-[#11141E] border border-slate-800 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#D4A72C]/10 border border-[#D4A72C]/30 text-[#D4A72C] flex items-center justify-center shrink-0">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Configuração da API Google Gemini</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Gerencie o modelo, ativação global, limite diário de requisições e validação server-side dos agentes <strong className="text-slate-200">Atendente IA</strong> e <strong className="text-slate-200">Prospector IA</strong>.
                  </p>
                </div>
              </div>
              <span
                className={`text-[10px] px-2.5 py-1 rounded font-bold uppercase ${
                  STATUS_BADGE[integrations.gemini.status] || STATUS_BADGE.nao_configurado
                }`}
              >
                {STATUS_LABEL[integrations.gemini.status] || integrations.gemini.status}
              </span>
            </div>

            {/* Global Toggle */}
            <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">
                  Ativar chamadas à API Google Gemini no CRM
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Controla respostas automáticas no WhatsApp, diagnóstico de sites no Prospector IA e laboratório dos agentes.
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-[#151926] border border-slate-700">
                <input
                  type="checkbox"
                  checked={geminiEnabled}
                  onChange={(e) => {
                    dirtySectionsRef.current.gemini = true;
                    setGeminiEnabled(e.target.checked);
                  }}
                  className="accent-[#D4A72C] w-4 h-4"
                />
                <span>{geminiEnabled ? 'Habilitado' : 'Desativado'}</span>
              </label>
            </div>

            {/* Model & Quota Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">Modelo Padrão do Gemini</label>
                <select
                  value={geminiModel}
                  onChange={(e) => {
                    dirtySectionsRef.current.gemini = true;
                    setGeminiModel(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                >
                  <option value="gemini-4-hydrogen">gemini-4-hydrogen (Padrão Recomendado)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra Rápido / Econômico)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Legado)</option>
                </select>
                <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={syncAgentsModel}
                    onChange={(e) => setSyncAgentsModel(e.target.checked)}
                    className="accent-[#D4A72C]"
                  />
                  <span>Aplicar automaticamente este modelo aos agentes que usam Gemini</span>
                </label>
              </div>

              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">Limite Diário de Requisições (Quota Guard)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={100000}
                    value={geminiQuotaLimit}
                    onChange={(e) => {
                      dirtySectionsRef.current.gemini = true;
                      setGeminiQuotaLimit(e.target.value);
                    }}
                    className="flex-1 bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleResetGeminiCounter}
                    disabled={savingIntegrations || integrations.gemini.requestsToday === 0}
                    className="px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40"
                  >
                    Zerar Uso
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Bloqueia novas chamadas automaticamente ao atingir a cota diária configurada.
                </p>
              </div>
            </div>

            {/* Daily usage bar */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-300 font-semibold">Consumo registrado hoje</span>
                <span className="font-mono text-white font-bold">
                  {integrations.gemini.requestsToday} / {integrations.gemini.quotaLimit} requisições
                  {geminiLastLatencyMs !== null ? ` • Última latência: ${geminiLastLatencyMs}ms` : ''}
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#D4A72C] h-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (integrations.gemini.requestsToday / Math.max(1, integrations.gemini.quotaLimit)) * 100
                    )}%`
                  }}
                />
              </div>
            </div>

            {/* Server Environment Secret Status (read-only) */}
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-slate-300 space-y-1.5">
              <div className="font-semibold text-[#D4A72C] flex items-center gap-1.5">
                <ShieldCheck size={14} />
                <span>Autenticação Server-Side &amp; Settings &gt; Secrets</span>
              </div>
              <p className="text-slate-300">
                Status da credencial no servidor:{' '}
                <strong className={integrations.gemini.hasEnvKey ? 'text-emerald-400' : 'text-amber-300'}>
                  {integrations.gemini.hasEnvKey
                    ? 'GEMINI_API_KEY ativa no ambiente do servidor'
                    : 'GEMINI_API_KEY não detectada no ambiente'}
                </strong>
              </p>
              <p className="text-slate-400">
                Todas as chamadas ao SDK <code className="text-slate-300">@google/genai</code> são executadas exclusivamente no servidor backend usando a chave configurada no painel <strong className="text-slate-200">Settings &gt; Secrets</strong> do ambiente, sem exposição ao navegador.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleTestGemini}
                disabled={testingGemini}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw size={14} className={testingGemini ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                <span>{testingGemini ? 'Testando API Gemini...' : 'Testar & Validar Gemini API'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveGeminiOnly}
                disabled={savingIntegrations}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
              >
                {savingIntegrations ? 'Salvando...' : 'Salvar Configurações Gemini'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2B: DEEPSEEK API DEDICATED CONFIG */}
      {activeTab === 'deepseek' && (
        <div className="space-y-4">
          <div className="p-6 rounded-xl bg-[#11141E] border border-slate-800 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#D4A72C]/10 border border-[#D4A72C]/30 text-[#D4A72C] flex items-center justify-center shrink-0">
                  <Cpu size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Configuração da DeepSeek API</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure autenticação server-side criptografada, endpoint, modelos dinâmicos via <code className="text-slate-300">GET /models</code>, cota e histórico para uso independente nos agentes autônomos.
                  </p>
                </div>
              </div>
              <span
                className={`text-[10px] px-2.5 py-1 rounded font-bold uppercase ${
                  STATUS_BADGE[integrations.deepseek?.status || 'nao_configurado'] || STATUS_BADGE.nao_configurado
                }`}
              >
                {STATUS_LABEL[integrations.deepseek?.status || 'nao_configurado'] || integrations.deepseek?.status || 'Não configurado'}
              </span>
            </div>

            {/* Global Toggle */}
            <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">
                  Ativar chamadas à DeepSeek API no CRM
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Permite selecionar modelos DeepSeek no Atendente IA e no Prospector IA, além de operar como fallback opcional.
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-[#151926] border border-slate-700">
                <input
                  type="checkbox"
                  checked={deepseekEnabled}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekEnabled(e.target.checked);
                  }}
                  className="accent-[#D4A72C] w-4 h-4"
                />
                <span>{deepseekEnabled ? 'Habilitado' : 'Desativado'}</span>
              </label>
            </div>

            {/* API Key Input + Save API Key + Show/Hide */}
            <div className="p-4 rounded-xl bg-[#0B0E16] border border-slate-800 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-slate-200 font-semibold flex items-center gap-1.5">
                  <KeyRound size={14} className="text-[#D4A72C]" />
                  <span>DeepSeek API Key (armazenamento criptografado exclusivo no servidor)</span>
                </label>
                <div className="flex items-center gap-3">
                  {integrations.deepseek?.hasApiKey && (
                    <span className="text-[11px] text-emerald-400 font-mono">
                      Chave salva ({integrations.deepseek.apiKeyHint || '••••'})
                    </span>
                  )}
                  {integrations.deepseek?.hasApiKey && (
                    <button
                      type="button"
                      onClick={() => handleClearSecret('deepseek', 'apiKey')}
                      className="text-[11px] text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={12} />
                      <span>Remover chave salva</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showDeepseekKey ? 'text' : 'password'}
                    value={deepseekApiKeyDraft}
                    onChange={(e) => {
                      dirtySectionsRef.current.deepseek = true;
                      setDeepseekApiKeyDraft(e.target.value);
                    }}
                    placeholder={
                      integrations.deepseek?.hasApiKey
                        ? `Chave criptografada ativa (${integrations.deepseek.apiKeyHint || '••••'}) — digite apenas para substituir`
                        : 'Cole sua DeepSeek API Key (ex: sk-...)'
                    }
                    className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 pr-10 text-white font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                    title={showDeepseekKey ? 'Ocultar chave' : 'Mostrar chave'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showDeepseekKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSaveDeepSeekApiKeyOnly}
                  disabled={savingIntegrations || !deepseekApiKeyDraft.trim()}
                  className="px-4 py-2.5 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap"
                >
                  <Lock size={13} />
                  <span>Salvar API Key</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Por segurança, a chave nunca é devolvida ao navegador ou gravada em texto puro. Ao sincronizar com o Firestore, vai protegida em cofre AES-256-GCM (<code className="text-slate-300">encryptedVault</code>).
              </p>
            </div>

            {/* Base URL + Model Dynamic Selector */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <label className="block text-slate-300 font-semibold">Base URL da API DeepSeek</label>
                <input
                  type="url"
                  value={deepseekBaseUrl}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekBaseUrl(e.target.value);
                  }}
                  placeholder="https://api.deepseek.com"
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                />
                <p className="text-[11px] text-slate-400">
                  Padrão oficial: <code className="text-slate-300">https://api.deepseek.com</code> (utilizado para <code className="text-slate-300">GET /models</code> e <code className="text-slate-300">POST /chat/completions</code>).
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-slate-300 font-semibold">Modelo DeepSeek Padrão</label>
                  <button
                    type="button"
                    onClick={handleRefreshDeepSeekModels}
                    disabled={loadingDeepSeekModels}
                    className="text-[11px] text-[#D4A72C] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  >
                    <RefreshCw size={11} className={loadingDeepSeekModels ? 'animate-spin' : ''} />
                    <span>{loadingDeepSeekModels ? 'Consultando GET /models...' : 'Atualizar Modelos (GET /models)'}</span>
                  </button>
                </div>
                <select
                  value={deepseekModel}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekModel(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                >
                  {deepseekAvailableModels.map((m) => (
                    <option key={m} value={m}>
                      {m === 'deepseek-flash'
                        ? 'deepseek-flash (Inicial / Baixa Latência)'
                        : m === 'deepseek-v4-pro'
                        ? 'deepseek-v4-pro (Inicial / Alta Capacidade)'
                        : m}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={syncDeepSeekAgentsModel}
                    onChange={(e) => setSyncDeepSeekAgentsModel(e.target.checked)}
                    className="accent-[#D4A72C]"
                  />
                  <span>Aplicar este modelo aos agentes configurados com DeepSeek</span>
                </label>
              </div>
            </div>

            {/* Quota, Timeout & Max Tokens */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="block text-slate-300 font-semibold">Limite Diário de Requisições</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={100000}
                    value={deepseekQuotaLimit}
                    onChange={(e) => {
                      dirtySectionsRef.current.deepseek = true;
                      setDeepseekQuotaLimit(e.target.value);
                    }}
                    className="flex-1 bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleResetDeepSeekCounter}
                    disabled={savingIntegrations || ((integrations.deepseek?.requestsToday ?? 0) === 0 && (integrations.deepseek?.tokensUsedToday ?? 0) === 0)}
                    className="px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40"
                  >
                    Zerar Uso
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-300 font-semibold">Timeout da Chamada (ms)</label>
                <input
                  type="number"
                  min={2000}
                  max={120000}
                  step={500}
                  value={deepseekTimeoutMs}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekTimeoutMs(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-300 font-semibold">Máximo de Tokens (max_tokens)</label>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  step={50}
                  value={deepseekMaxTokens}
                  onChange={(e) => {
                    dirtySectionsRef.current.deepseek = true;
                    setDeepseekMaxTokens(e.target.value);
                  }}
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 text-white font-mono"
                />
              </div>
            </div>

            {/* Daily usage & token bar */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-300 font-semibold">Consumo registrado hoje (Requisições &amp; Tokens)</span>
                <div className="flex flex-wrap items-center gap-3 font-mono text-white font-bold">
                  <span>
                    {integrations.deepseek?.requestsToday ?? 0} / {integrations.deepseek?.quotaLimit ?? 1500} req
                  </span>
                  <span className="text-[#D4A72C]">
                    {(integrations.deepseek?.tokensUsedToday ?? 0).toLocaleString('pt-BR')} tokens
                  </span>
                  {deepseekLastLatencyMs !== null && (
                    <span className="text-emerald-300">{deepseekLastLatencyMs}ms</span>
                  )}
                </div>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#D4A72C] h-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      ((integrations.deepseek?.requestsToday ?? 0) / Math.max(1, integrations.deepseek?.quotaLimit || 1500)) * 100
                    )}%`
                  }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleTestDeepSeek}
                disabled={testingDeepSeek}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw size={14} className={testingDeepSeek ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                <span>{testingDeepSeek ? 'Testando Conexão...' : 'Testar Conexão DeepSeek'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveDeepSeekOnly}
                disabled={savingIntegrations}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
              >
                {savingIntegrations ? 'Salvando...' : 'Salvar Configurações DeepSeek'}
              </button>
            </div>

            {/* Usage, Error & Token History */}
            <div className="p-4 rounded-xl bg-[#0B0E16] border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Clock size={14} className="text-[#D4A72C]" />
                  <span>Histórico de Uso, Erros &amp; Consumo de Tokens ({integrations.deepseek?.usageHistory?.length || 0})</span>
                </div>
                {integrations.deepseek?.modelsUpdatedAt && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    Modelos atualizados: {new Date(integrations.deepseek.modelsUpdatedAt).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>

              {!integrations.deepseek?.usageHistory?.length ? (
                <div className="text-slate-500 italic text-[11px] py-2">
                  Nenhuma chamada DeepSeek registrada ainda. Clique em "Testar Conexão DeepSeek" ou execute um agente usando DeepSeek.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-1.5 pr-3 font-semibold">Data/Hora</th>
                        <th className="py-1.5 pr-3 font-semibold">Origem</th>
                        <th className="py-1.5 pr-3 font-semibold">Modelo</th>
                        <th className="py-1.5 pr-3 font-semibold">Status</th>
                        <th className="py-1.5 pr-3 font-semibold">Tokens</th>
                        <th className="py-1.5 pr-3 font-semibold">Latência</th>
                        <th className="py-1.5 font-semibold">Detalhe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {integrations.deepseek.usageHistory.map((log) => (
                        <tr key={log.id} className="text-slate-300">
                          <td className="py-1.5 pr-3 font-mono text-slate-400 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-1.5 pr-3 font-mono uppercase text-[10px]">{log.agentId}</td>
                          <td className="py-1.5 pr-3 font-mono text-white">{log.model}</td>
                          <td className="py-1.5 pr-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                log.status === 'sucesso'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : log.status === 'sem_saldo'
                                  ? 'bg-orange-500/20 text-orange-300'
                                  : log.status === 'limite_atingido'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {log.status}{log.httpStatus ? ` (${log.httpStatus})` : ''}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-[#D4A72C] whitespace-nowrap">
                            {typeof log.totalTokens === 'number' ? `${log.totalTokens} tok` : '—'}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-slate-400 whitespace-nowrap">
                            {typeof log.latencyMs === 'number' ? `${log.latencyMs}ms` : '—'}
                          </td>
                          <td className="py-1.5 text-slate-400 max-w-xs truncate" title={log.errorSummary || ''}>
                            {log.errorSummary || 'OK'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: GOOGLE PLACES API DEDICATED CONFIG */}
      {activeTab === 'places' && (
        <div className="space-y-4">
          <div className="p-6 rounded-xl bg-[#11141E] border border-slate-800 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#D4A72C]/10 border border-[#D4A72C]/30 text-[#D4A72C] flex items-center justify-center shrink-0">
                  <MapPin size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Configuração da API Google Places (New)</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure e valide sua chave da <strong className="text-slate-200">Places API (New)</strong> no Google Cloud para habilitar o Radar Automático no módulo Prospecção.
                  </p>
                </div>
              </div>
              <span
                className={`text-[10px] px-2.5 py-1 rounded font-bold uppercase ${
                  STATUS_BADGE[integrations.googlePlaces.status] || STATUS_BADGE.nao_configurado
                }`}
              >
                {STATUS_LABEL[integrations.googlePlaces.status] || integrations.googlePlaces.status}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">
                  Ativar busca automática via Google Places na Prospecção
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Mantém o Radar desativado enquanto estiver desmarcado ou sem chave válida no servidor.
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-[#151926] border border-slate-700">
                <input
                  type="checkbox"
                  checked={placesEnabled}
                  onChange={(e) => {
                    dirtySectionsRef.current.places = true;
                    setPlacesEnabled(e.target.checked);
                  }}
                  className="accent-[#D4A72C] w-4 h-4"
                />
                <span>{placesEnabled ? 'Habilitado' : 'Desativado'}</span>
              </label>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <KeyRound size={13} className="text-[#D4A72C]" />
                  <span>Google Places API Key</span>
                </label>
                {integrations.googlePlaces.hasApiKey && (
                  <button
                    type="button"
                    onClick={() => handleClearSecret('googlePlaces', 'apiKey')}
                    className="text-[11px] text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    <span>Remover chave salva</span>
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  type={showPlacesKey ? 'text' : 'password'}
                  value={placesApiKeyDraft}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPlacesApiKeyDraft(val);
                    if (val.trim()) setPlacesEnabled(true);
                  }}
                  placeholder={
                    integrations.googlePlaces.hasApiKey
                      ? `Chave salva (${integrations.googlePlaces.apiKeyHint || '••••'}) — digite apenas para substituir`
                      : 'Cole sua API Key autorizada do Google Cloud (Places API)'
                  }
                  className="w-full bg-[#151926] border border-slate-700 focus:border-[#D4A72C] outline-none rounded-lg p-2.5 pr-10 text-white font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPlacesKey(!showPlacesKey)}
                  title={showPlacesKey ? 'Ocultar chave' : 'Mostrar chave'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  {showPlacesKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-slate-300 space-y-1.5">
              <div className="font-semibold text-[#D4A72C] flex items-center gap-1.5">
                <ShieldCheck size={14} />
                <span>Places API (New), Segurança e Proteção contra Cobranças</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>
                  O sistema utiliza exclusivamente o endpoint moderno <code className="text-slate-300">Places API (New)</code> (<code className="text-slate-300">places.googleapis.com/v1/places:searchText</code>) em conformidade com as políticas do Google Maps Platform. Certifique-se de ativar <strong>Places API (New)</strong> no seu projeto Google Cloud.
                </li>
                <li>
                  A chave é gravada exclusivamente no servidor (<code className="text-slate-300">/data/db.json</code>) e nunca é retornada para o navegador.
                </li>
                <li>
                  Enquanto não houver uma chave autorizada e testada, o Radar permanece bloqueado e você pode usar Cadastro Manual, Importação CSV e Auditoria de Sites gratuitamente.
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleTestGooglePlaces}
                disabled={testingPlaces || (!placesApiKeyDraft.trim() && !integrations.googlePlaces.hasApiKey)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw size={14} className={testingPlaces ? 'animate-spin text-[#D4A72C]' : 'text-[#D4A72C]'} />
                <span>{testingPlaces ? 'Validando API Key...' : 'Testar & Conectar Google Places'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveGooglePlacesOnly}
                disabled={savingIntegrations}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
              >
                {savingIntegrations ? 'Salvando...' : 'Salvar Configurações Places'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SERVICES & PRICING */}
      {activeTab === 'services' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingServiceId ? 'Editar Serviço / Plano' : 'Cadastrar Serviço / Plano Real'}
              </h3>
              {editingServiceId && (
                <button
                  type="button"
                  onClick={resetServiceForm}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <X size={13} /> Cancelar edição
                </button>
              )}
            </div>

            <form onSubmit={handleSubmitService} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <input
                type="text"
                placeholder="Nome do serviço *"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
                required
              />
              <input
                type="number"
                step="0.01"
                min={0}
                placeholder="Preço base (R$) *"
                value={servicePrice}
                onChange={(e) => setServicePrice(e.target.value)}
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white font-mono"
                required
              />
              <select
                value={serviceCycle}
                onChange={(e) => setServiceCycle(e.target.value as any)}
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="unico">Pagamento Único</option>
                <option value="mensal">Mensal Recorrente (MRR)</option>
                <option value="anual">Anual</option>
              </select>
              <button
                type="submit"
                disabled={savingService}
                className="py-2 px-4 rounded-lg bg-[#D4A72C] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Plus size={14} />
                <span>{savingService ? 'Salvando...' : editingServiceId ? 'Atualizar Serviço' : 'Cadastrar Serviço'}</span>
              </button>

              <input
                type="text"
                placeholder="Descrição comercial do plano..."
                value={serviceDesc}
                onChange={(e) => setServiceDesc(e.target.value)}
                className="sm:col-span-2 bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
              <input
                type="text"
                placeholder="Itens inclusos separados por vírgula (ex: SSL, Responsivo, SEO)"
                value={serviceFeaturesText}
                onChange={(e) => setServiceFeaturesText(e.target.value)}
                className="sm:col-span-2 bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
            </form>
          </div>

          {services.length === 0 ? (
            <div className="p-10 text-center rounded-xl bg-[#11141E] border border-slate-800 text-slate-400 text-xs space-y-1.5">
              <div className="font-semibold text-slate-200 text-sm">
                Nenhum serviço cadastrado na tabela comercial
              </div>
              <p className="text-[11px] text-slate-500">
                Os planos demonstrativos foram removidos. Cadastre acima os serviços e preços reais praticados pela Fazer Meu Website.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {services.map((svc) => (
                <div key={svc.id} className="p-4 rounded-xl bg-[#11141E] border border-slate-800 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white">{svc.name}</h4>
                      {svc.description && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{svc.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono font-bold text-[#D4A72C]">
                        R$ {svc.basePrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        <span className="text-[10px] text-slate-400 font-normal">
                          {svc.billingCycle === 'mensal'
                            ? '/mês'
                            : svc.billingCycle === 'anual'
                            ? '/ano'
                            : ' (único)'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleStartEditService(svc)}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                        title="Editar serviço"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteService(svc.id)}
                        className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white cursor-pointer"
                        title="Excluir serviço"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {svc.features && svc.features.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 flex items-center gap-1.5 flex-wrap">
                      {svc.features.map((feat, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400"
                        >
                          ✓ {feat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: USERS & RBAC */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Create User Form */}
          <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus size={15} className="text-[#D4A72C]" />
              <span>Cadastrar Novo Usuário com Acesso RBAC</span>
            </h3>
            <form onSubmit={handleCreateUserSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <input
                type="text"
                placeholder="Nome completo *"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                required
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
              <input
                type="email"
                placeholder="E-mail corporativo *"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                required
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
              <input
                type="password"
                placeholder="Senha inicial (min. 6) *"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                minLength={6}
                required
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="admin">Administrador (Total)</option>
                <option value="comercial">Comercial (CRM, Propostas, Prospecção)</option>
                <option value="suporte">Suporte (Chamados, Projetos, Clientes)</option>
                <option value="financeiro">Financeiro (Receitas, Despesas, Asaas)</option>
              </select>
              <button
                type="submit"
                disabled={savingUser}
                className="py-2 px-4 rounded-lg bg-[#D4A72C] text-slate-950 font-bold hover:brightness-110 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Plus size={14} />
                <span>{savingUser ? 'Criando...' : 'Criar Usuário'}</span>
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {users.map((user) => {
              const isSelf = user.id === currentUser.id;
              return (
                <div key={user.id} className="p-4 rounded-xl bg-[#11141E] border border-slate-800 space-y-3">
                  <div className="flex items-center gap-3.5">
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-11 h-11 rounded-xl object-cover border border-[#D4A72C]/40 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-xs font-bold text-white truncate">{user.name}</h4>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#D4A72C]/20 text-[#D4A72C]">
                          {user.role}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            Você
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{user.email}</p>
                      <div className="text-[10px] mt-1 flex items-center gap-2">
                        <span className={user.active ? 'text-emerald-400' : 'text-rose-400'}>
                          ● {user.active ? 'Ativo' : 'Desativado'}
                        </span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400 flex items-center gap-1">
                          <ShieldCheck size={11} className="text-[#D4A72C]" />
                          {user.hasPassword ? 'Senha configurada' : 'Sem senha'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Role & Actions */}
                  <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <select
                      value={user.role}
                      disabled={isSelf}
                      onChange={(e) => onUpdateUser(user.id, { role: e.target.value as UserRole })}
                      className="bg-[#151926] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                    >
                      <option value="admin">admin</option>
                      <option value="comercial">comercial</option>
                      <option value="suporte">suporte</option>
                      <option value="financeiro">financeiro</option>
                    </select>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (editUserId === user.id) {
                            setEditUserId(null);
                          } else {
                            setEditUserId(user.id);
                            setEditUserName(user.name);
                            setEditUserEmail(user.email);
                            setResetPwdUserId(null);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 size={11} />
                        <span>Editar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setResetPwdUserId(resetPwdUserId === user.id ? null : user.id);
                          setResetPwdValue('');
                          setEditUserId(null);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <KeyRound size={11} />
                        <span>Senha</span>
                      </button>

                      {!isSelf && (
                        <>
                          <button
                            type="button"
                            onClick={() => onUpdateUser(user.id, { active: !user.active })}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                              user.active
                                ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            }`}
                          >
                            {user.active ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteUser(user.id)}
                            className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white cursor-pointer"
                            title="Excluir usuário"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editUserId === user.id && (
                    <div className="space-y-2 pt-2 border-t border-slate-800/70">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Nome completo"
                          value={editUserName}
                          onChange={(e) => setEditUserName(e.target.value)}
                          className="bg-[#090B10] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                        />
                        <input
                          type="email"
                          placeholder="E-mail corporativo (ex: admin@fazermeuwebsite.com.br)"
                          value={editUserEmail}
                          onChange={(e) => setEditUserEmail(e.target.value)}
                          className="bg-[#090B10] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditUserId(null)}
                          className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={savingUserAction}
                          onClick={() => handleSaveUserIdentity(user.id)}
                          className="px-3 py-1.5 rounded bg-[#D4A72C] text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50"
                        >
                          {savingUserAction ? 'Salvando...' : 'Salvar E-mail / Nome'}
                        </button>
                      </div>
                    </div>
                  )}

                  {resetPwdUserId === user.id && (
                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="password"
                        placeholder="Nova senha (min. 6)"
                        value={resetPwdValue}
                        onChange={(e) => setResetPwdValue(e.target.value)}
                        className="flex-1 bg-[#090B10] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={savingUserAction}
                        onClick={() => handleResetUserPassword(user.id)}
                        className="px-3 py-1.5 rounded bg-[#D4A72C] text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50"
                      >
                        {savingUserAction ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
