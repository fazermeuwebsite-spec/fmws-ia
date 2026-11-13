import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, X, MessageSquare, ArrowRight } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { LoginScreen } from './components/LoginScreen';
import { DashboardModule } from './components/DashboardModule';
import { CrmModule } from './components/CrmModule';
import { ProspectingModule } from './components/ProspectingModule';
import { WhatsAppModule } from './components/WhatsAppModule';
import { ClientsModule } from './components/ClientsModule';
import { ProposalsModule } from './components/ProposalsModule';
import { ProjectsModule } from './components/ProjectsModule';
import { FinancialModule } from './components/FinancialModule';
import { SupportModule } from './components/SupportModule';
import { AIAgentsModule } from './components/AIAgentsModule';
import { ReportsModule } from './components/ReportsModule';
import { SettingsModule } from './components/SettingsModule';

import { LeadModal } from './components/modals/LeadModal';
import { ClientModal } from './components/modals/ClientModal';
import { ProposalModal } from './components/modals/ProposalModal';
import { ProjectModal } from './components/modals/ProjectModal';
import { TicketModal } from './components/modals/TicketModal';
import { TransactionModal } from './components/modals/TransactionModal';

import { api, getStoredSessionToken } from './services/api';
import {
  auth as firebaseAuth,
  onAuthStateChanged,
  signInFirebaseWithGoogle,
  syncSnapshotToFirestore,
  loadSnapshotFromFirestore,
  testFirestoreConnection,
  subscribeWhatsAppConversationsFromFirestore,
  subscribeWhatsAppMessagesFromFirestore,
  subscribeWhatsAppLogsFromFirestore,
  fetchWhatsAppMessagesOnceFromFirestore,
  upsertWhatsAppConversationInFirestore,
  deleteWhatsAppConversationInFirestore,
  scanDuplicateWhatsAppConversationsInFirestore,
  mergeDuplicateWhatsAppGroupInFirestore,
  whatsAppPhonesMatch,
  type WhatsAppDuplicateGroupPreview,
  type FirebaseUser
} from './firebase';
import {
  User,
  UserRole,
  Lead,
  Client,
  WhatsAppConversation,
  WhatsAppIntegrationLog,
  Proposal,
  Project,
  FinancialTransaction,
  SupportTicket,
  AIAgentConfig,
  SystemIntegrations,
  ServiceProduct,
  LeadStatus,
  ProjectStage,
  KanbanStageConfig,
  ProspectCompany
} from './types';
import {
  defaultCrmStages,
  defaultProjectStages,
  initialIntegrations
} from './server/initialData';

const MANUAL_LOGOUT_STORAGE_KEY = 'fmws_manual_logout';

export default function App() {
  // Authentication state
  const [authChecking, setAuthChecking] = useState(true);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);

  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [settingsInitialTab, setSettingsInitialTab] = useState<'integrations' | 'gemini' | 'places' | 'services' | 'users'>('integrations');
  const [users, setUsers] = useState<User[]>([]);

  // Data collections
  const [crmStages, setCrmStages] = useState<KanbanStageConfig[]>(defaultCrmStages);
  const [projectStages, setProjectStages] = useState<KanbanStageConfig[]>(defaultProjectStages);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [prospects, setProspects] = useState<ProspectCompany[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [whatsappConversations, setWhatsappConversations] = useState<WhatsAppConversation[]>([]);
  const [whatsappAttendants, setWhatsappAttendants] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [selectedClientIdFromWhatsApp, setSelectedClientIdFromWhatsApp] = useState<string | null>(null);
  const [activeWhatsAppId, setActiveWhatsAppId] = useState<string>('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [financial, setFinancial] = useState<FinancialTransaction[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [aiAgents, setAiAgents] = useState<AIAgentConfig[]>([]);
  const [integrations, setIntegrations] = useState<SystemIntegrations>(initialIntegrations);
  const [services, setServices] = useState<ServiceProduct[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Firebase Cloud Firestore auth & sync state
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [firestoreOnline, setFirestoreOnline] = useState<boolean>(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'disconnected' | 'syncing' | 'synced' | 'error'>('disconnected');
  const [cloudRestoreComplete, setCloudRestoreComplete] = useState(false);
  const [dataLoadedNonce, setDataLoadedNonce] = useState(0);
  const dataReadyRef = useRef(false);
  const restoredFromFirestoreRef = useRef(false);
  const restoringFromCloudRef = useRef(false);
  const autoResumeAttemptedRef = useRef(false);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const resyncRequestedRef = useRef(false);

  // Real-time WhatsApp state & notifications
  const [firestoreLogs, setFirestoreLogs] = useState<WhatsAppIntegrationLog[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<WhatsAppDuplicateGroupPreview[]>([]);
  const [scanningDuplicates, setScanningDuplicates] = useState(false);
  const [mergingDuplicateKey, setMergingDuplicateKey] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'ws' | 'sse' | 'connecting' | 'offline'>('connecting');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [waNotification, setWaNotification] = useState<{
    id: string;
    conversationId: string;
    contactName: string;
    text: string;
    timestamp: string;
  } | null>(null);
  const currentTabRef = useRef(currentTab);
  const activeWhatsAppIdRef = useRef(activeWhatsAppId);
  const soundEnabledRef = useRef(soundEnabled);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firestoreConvInitRef = useRef(false);
  const lastSeenFsTimestampsRef = useRef<Map<string, number>>(new Map());
  const hydratedMsgConvIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    activeWhatsAppIdRef.current = activeWhatsAppId;
  }, [activeWhatsAppId]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Modals state
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [initialLeadForProposal, setInitialLeadForProposal] = useState<Lead | null>(null);

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [initialClientForTicket, setInitialClientForTicket] = useState<Client | null>(null);

  const [transactionModalOpen, setTransactionModalOpen] = useState(false);

  const hasPerm = useCallback(
    (perm: string, perms = permissions) =>
      currentUser?.role === 'admin' || perms.includes('*') || perms.includes(perm),
    [permissions, currentUser?.role]
  );

  const refreshSession = useCallback(async () => {
    const session = await api.getSession();
    setNeedsAdminSetup(session.needsAdminSetup);
    if (session.authenticated && session.user) {
      setCurrentUser(session.user);
      setPermissions(session.permissions || []);
    } else {
      setCurrentUser(null);
      setPermissions([]);
    }
  }, []);

  // Track Firebase Google user session for Firestore sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (fbUser) => {
      setFirebaseUser(fbUser);
      setFirebaseAuthReady(true);
      if (!fbUser) {
        setCloudSyncStatus('disconnected');
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen globally for expired/revoked backend sessions (401)
  useEffect(() => {
    const onAuthExpired = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string }>).detail;
      dataReadyRef.current = false;
      restoredFromFirestoreRef.current = false;
      restoringFromCloudRef.current = false;
      setCloudRestoreComplete(false);
      setCurrentUser(null);
      setPermissions([]);
      setGlobalError(null);
      setSessionNotice(
        detail?.message || 'Sua sessão expirou ou foi encerrada. Faça login novamente.'
      );
      api
        .getSession()
        .then((session) => {
          setNeedsAdminSetup(session.needsAdminSetup);
        })
        .catch(() => {});
    };
    window.addEventListener('fmws-auth-expired', onAuthExpired);
    return () => window.removeEventListener('fmws-auth-expired', onAuthExpired);
  }, []);

  // Check authentication session & Firestore connection on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        testFirestoreConnection()
          .then((res) => {
            if (active) setFirestoreOnline(res.ok);
          })
          .catch(() => {});
        const session = await api.getSession();
        if (!active) return;
        setNeedsAdminSetup(session.needsAdminSetup);
        if (session.authenticated && session.user) {
          setCurrentUser(session.user);
          setPermissions(session.permissions || []);
        } else {
          setCurrentUser(null);
          setPermissions([]);
        }
      } catch (err: any) {
        if (!active) return;
        setGlobalError(err.message || 'Falha ao verificar sessão.');
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load authorized collections after login
  const loadAllData = useCallback(async (userPerms: string[], userRole?: string) => {
    setDataLoading(true);
    setGlobalError(null);
    const can = (p: string) =>
      userRole === 'admin' || userPerms.includes('*') || userPerms.includes(p);

    try {
      const results = await Promise.allSettled([
        can('users.manage') ? api.getUsers() : Promise.resolve([]),
        api.getKanbanStages(),
        can('crm.read') ? api.getLeads() : Promise.resolve([]),
        can('prospecting.read') ? api.getProspects() : Promise.resolve([]),
        can('clients.read') ? api.getClients() : Promise.resolve([]),
        can('whatsapp.read') ? api.getWhatsAppConversations() : Promise.resolve([]),
        can('proposals.read') ? api.getProposals() : Promise.resolve([]),
        can('projects.read') ? api.getProjects() : Promise.resolve([]),
        can('financial.read') ? api.getFinancial() : Promise.resolve([]),
        can('support.read') ? api.getSupportTickets() : Promise.resolve([]),
        api.getAIAgents(),
        api.getIntegrations(),
        api.getServices(),
        api.getDashboardMetrics(),
        can('whatsapp.read') ? api.getWhatsAppAttendants() : Promise.resolve([])
      ]);

      const val = <T,>(idx: number, fallback: T): T => {
        const r = results[idx];
        return r.status === 'fulfilled' && r.value !== undefined && r.value !== null
          ? (r.value as T)
          : fallback;
      };

      setUsers(val<User[]>(0, []));
      const stagesRes = val<{ crmStages: KanbanStageConfig[]; projectStages: KanbanStageConfig[] }>(
        1,
        { crmStages: defaultCrmStages, projectStages: defaultProjectStages }
      );
      if (stagesRes.crmStages?.length) setCrmStages(stagesRes.crmStages);
      if (stagesRes.projectStages?.length) setProjectStages(stagesRes.projectStages);

      setLeads(val<Lead[]>(2, []));
      setProspects(val<ProspectCompany[]>(3, []));
      setClients(val<Client[]>(4, []));
      const convs = val<WhatsAppConversation[]>(5, []);
      setWhatsappConversations(convs);
      if (convs.length) {
        setActiveWhatsAppId((prev) => prev || convs[0].id);
      }

      setProposals(val<Proposal[]>(6, []));
      setProjects(val<Project[]>(7, []));
      setFinancial(val<FinancialTransaction[]>(8, []));
      setSupportTickets(val<SupportTicket[]>(9, []));
      setAiAgents(val<AIAgentConfig[]>(10, []));
      setIntegrations(val<SystemIntegrations>(11, initialIntegrations));
      setServices(val<ServiceProduct[]>(12, []));
      setMetrics(val<any>(13, null));
      setWhatsappAttendants(val<Array<{ id: string; name: string; role: string }>>(14, []));
      dataReadyRef.current = true;
      setDataLoadedNonce((n) => n + 1);
    } catch (err: any) {
      setGlobalError(err.message || 'Erro ao carregar dados do servidor.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  const syncNowToFirestore = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin' || !firebaseAuth.currentUser?.emailVerified) return;

    if (syncInFlightRef.current) {
      resyncRequestedRef.current = true;
      await syncInFlightRef.current;
      return;
    }

    const runner = (async () => {
      setCloudSyncStatus('syncing');
      try {
        do {
          resyncRequestedRef.current = false;
          const snapshot = await api.exportCloudSnapshot();
          await syncSnapshotToFirestore(snapshot);
        } while (resyncRequestedRef.current);
        setCloudSyncStatus('synced');
      } catch (err) {
        console.error('Automatic Firestore sync failed:', err);
        setCloudSyncStatus('error');
      } finally {
        syncInFlightRef.current = null;
      }
    })();

    syncInFlightRef.current = runner;
    await runner;
  }, [currentUser]);

  const handleConnectFirebase = useCallback(async () => {
    try {
      setCloudSyncStatus('syncing');
      restoredFromFirestoreRef.current = true;
      const fbUser = await signInFirebaseWithGoogle();
      try {
        const idToken = await fbUser.getIdToken();
        const linked = await api.linkGoogleAccount(idToken);
        if (linked?.user) {
          setCurrentUser(linked.user);
        }
      } catch {
        // Sync can still proceed even if account linking fails
      }
      const snapshot = await api.exportCloudSnapshot();
      await syncSnapshotToFirestore(snapshot);
      setCloudRestoreComplete(true);
      setCloudSyncStatus('synced');
    } catch (err: any) {
      setCloudSyncStatus('error');
      setGlobalError(err?.message || 'Não foi possível vincular sua conta Google ao Firestore.');
    }
  }, []);

  // Automatically sync persisted CRM changes to Firestore whenever Firebase Google session is linked
  // (WhatsApp changes are synced incrementally via direct Firestore mutations + onSnapshot listeners)
  useEffect(() => {
    if (
      !currentUser ||
      currentUser.role !== 'admin' ||
      !firebaseUser?.emailVerified ||
      !dataReadyRef.current ||
      !cloudRestoreComplete ||
      restoringFromCloudRef.current
    ) {
      return;
    }
    const timer = setTimeout(() => {
      syncNowToFirestore();
    }, 250);
    return () => clearTimeout(timer);
  }, [
    currentUser,
    firebaseUser,
    cloudRestoreComplete,
    leads,
    clients,
    prospects,
    proposals,
    projects,
    financial,
    supportTickets,
    aiAgents,
    services,
    crmStages,
    projectStages,
    users,
    integrations,
    syncNowToFirestore
  ]);

  useEffect(() => {
    if (!currentUser) {
      loadedSessionKeyRef.current = null;
      return;
    }
    const sessionKey = `${currentUser.id}:${currentUser.role}:${permissions.join(',')}`;
    if (loadedSessionKeyRef.current === sessionKey) return;
    loadedSessionKeyRef.current = sessionKey;
    loadAllData(permissions, currentUser.role);
  }, [currentUser, permissions, loadAllData]);

  // Auto-link active Google Firebase session & auto-restore empty container DB from Firestore
  useEffect(() => {
    if (!currentUser || !firebaseUser?.emailVerified || dataLoadedNonce === 0 || !dataReadyRef.current) {
      return;
    }

    if (
      firebaseUser.email &&
      currentUser.linkedGoogleEmail?.toLowerCase() !== firebaseUser.email.toLowerCase()
    ) {
      firebaseUser
        .getIdToken()
        .then((idToken) => api.linkGoogleAccount(idToken))
        .then((res) => {
          if (res?.user) setCurrentUser(res.user);
        })
        .catch(() => {});
    }

    if (restoredFromFirestoreRef.current) return;
    restoredFromFirestoreRef.current = true;

    if (currentUser.role !== 'admin') {
      setCloudRestoreComplete(true);
      return;
    }

    const isLocalEmpty =
      leads.length === 0 &&
      clients.length === 0 &&
      prospects.length === 0 &&
      proposals.length === 0 &&
      projects.length === 0 &&
      financial.length === 0 &&
      supportTickets.length === 0 &&
      whatsappConversations.length === 0 &&
      services.length === 0;

    const hasAnyLocalIntegrationSecret = Boolean(
      integrations.googlePlaces.hasApiKey ||
        integrations.metaCloud.hasAccessToken ||
        integrations.metaCloud.hasWebhookVerifyToken ||
        integrations.metaCloud.hasBridgeSecret ||
        integrations.asaas.hasApiKey
    );

    const needsIntegrationSecretRestore = !hasAnyLocalIntegrationSecret;

    const needsUserCredentialsRestore =
      currentUser.role === 'admin' && !currentUser.hasPassword;

    if (!isLocalEmpty && !needsIntegrationSecretRestore && !needsUserCredentialsRestore) {
      setCloudRestoreComplete(true);
      return;
    }

    restoringFromCloudRef.current = true;
    loadSnapshotFromFirestore()
      .then(async (snapshot) => {
        const hasAnyCloudBuckets = Object.values(snapshot.buckets || {}).some(
          (arr) => Array.isArray(arr) && arr.length > 0
        );
        const hasCloudUsers = Array.isArray(snapshot.users) && snapshot.users.length > 1;
        if (isLocalEmpty && (hasAnyCloudBuckets || hasCloudUsers)) {
          await api.restoreCloudSnapshot(snapshot.buckets, snapshot.users, { onlyFillMissing: false });
          await loadAllData(permissions, currentUser.role);
          setCloudSyncStatus('synced');
        } else if (!isLocalEmpty && (needsIntegrationSecretRestore || needsUserCredentialsRestore)) {
          const partialBuckets: Record<string, any[]> = {};
          if (
            needsIntegrationSecretRestore &&
            Array.isArray(snapshot.buckets?.integrationsConfig) &&
            snapshot.buckets.integrationsConfig[0]?.encryptedVault
          ) {
            partialBuckets.integrationsConfig = snapshot.buckets.integrationsConfig;
          }
          const hasCloudUserHashes =
            needsUserCredentialsRestore &&
            Array.isArray(snapshot.users) &&
            snapshot.users.some((u: any) => typeof u?.passwordHash === 'string' && u.passwordHash.length >= 10);

          if (Object.keys(partialBuckets).length > 0 || hasCloudUserHashes) {
            await api.restoreCloudSnapshot(
              partialBuckets,
              hasCloudUserHashes ? snapshot.users : undefined,
              { onlyFillMissing: true }
            );
            if (Object.keys(partialBuckets).length > 0) {
              setIntegrations(await api.getIntegrations());
            }
            if (hasCloudUserHashes) {
              const freshUsers = await api.getUsers();
              setUsers(freshUsers);
              const me = freshUsers.find((u) => u.id === currentUser.id);
              if (me) setCurrentUser(me);
            }
            setCloudSyncStatus('synced');
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        restoringFromCloudRef.current = false;
        setCloudRestoreComplete(true);
      });
  }, [
    currentUser,
    firebaseUser,
    dataLoadedNonce,
    leads.length,
    clients.length,
    prospects.length,
    proposals.length,
    projects.length,
    financial.length,
    supportTickets.length,
    whatsappConversations.length,
    services.length,
    integrations.googlePlaces.hasApiKey,
    integrations.metaCloud.hasAccessToken,
    integrations.metaCloud.hasWebhookVerifyToken,
    integrations.metaCloud.hasBridgeSecret,
    integrations.asaas.hasApiKey,
    permissions,
    loadAllData
  ]);

  // Real-time WhatsApp WebSocket + SSE fallback subscription
  const playNotificationChime = useCallback(() => {
    if (!soundEnabledRef.current || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(660, now);
      osc1.frequency.setValueAtTime(880, now + 0.08);
      gain1.gain.setValueAtTime(0.08, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.26);
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 400);
    } catch {
      // ignore AudioContext autoplay restrictions
    }
  }, []);

  const canReadWhatsApp = Boolean(
    currentUser &&
      (currentUser.role === 'admin' ||
        permissions.includes('*') ||
        permissions.includes('whatsapp.read'))
  );

  useEffect(() => {
    if (!currentUser || !canReadWhatsApp) {
      setRealtimeStatus('offline');
      return;
    }

    let disposed = false;
    let ws: WebSocket | null = null;
    let sse: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const handleRealtimeEvent = (rawData: string) => {
      try {
        const event = JSON.parse(rawData);
        if (!event || typeof event.type !== 'string') return;

        if (event.type === 'whatsapp:init' && Array.isArray(event.conversations)) {
          setWhatsappConversations(event.conversations);
          setActiveWhatsAppId((prev) => prev || event.conversations[0]?.id || '');
          return;
        }

        if (event.type === 'whatsapp:conversation_created' && event.conversation) {
          const created = event.conversation as WhatsAppConversation;
          setWhatsappConversations((prev) => {
            if (prev.some((c) => c.id === created.id)) {
              return prev.map((c) => (c.id === created.id ? created : c));
            }
            return [created, ...prev];
          });
          setActiveWhatsAppId((prev) => prev || created.id);
          return;
        }

        if (event.type === 'whatsapp:conversation_updated' && event.conversation) {
          const updated = event.conversation as WhatsAppConversation;
          setWhatsappConversations((prev) => {
            const exists = prev.some((c) => c.id === updated.id);
            return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
          });
          return;
        }

        if (event.type === 'whatsapp:conversation_deleted' && event.conversationId) {
          const deletedId = String(event.conversationId);
          setWhatsappConversations((prev) => {
            const remaining = prev.filter((c) => c.id !== deletedId);
            if (activeWhatsAppIdRef.current === deletedId) {
              setActiveWhatsAppId(remaining[0]?.id || '');
            }
            return remaining;
          });
          return;
        }

        if (event.type === 'whatsapp:message_created' && event.conversation && event.message) {
          const incomingConv = event.conversation as WhatsAppConversation;
          const incomingMsg = event.message as WhatsAppConversation['messages'][number];

          setWhatsappConversations((prev) => {
            const existing = prev.find((c) => c.id === incomingConv.id);
            let mergedConv = incomingConv;
            if (existing) {
              const hasMsg = existing.messages.some((m) => m.id === incomingMsg.id);
              const mergedMessages = hasMsg
                ? existing.messages
                : [...existing.messages, incomingMsg];
              mergedConv = {
                ...incomingConv,
                messages:
                  incomingConv.messages.length >= mergedMessages.length
                    ? incomingConv.messages
                    : mergedMessages
              };
            }
            const rest = prev.filter((c) => c.id !== incomingConv.id);
            return [mergedConv, ...rest];
          });

          const isViewingThisChat =
            currentTabRef.current === 'whatsapp' &&
            activeWhatsAppIdRef.current === incomingConv.id &&
            typeof document !== 'undefined' &&
            !document.hidden;

          const shouldNotify =
            incomingMsg.sender === 'contact' || (Boolean(incomingMsg.aiGenerated) && !isViewingThisChat);

          if (shouldNotify) {
            playNotificationChime();
            if (!isViewingThisChat) {
              setWaNotification({
                id: incomingMsg.id,
                conversationId: incomingConv.id,
                contactName: incomingConv.contactName,
                text: incomingMsg.text,
                timestamp: incomingMsg.timestamp
              });
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              toastTimerRef.current = setTimeout(() => {
                setWaNotification(null);
              }, 7000);
            }

            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted' &&
              (document.hidden || currentTabRef.current !== 'whatsapp' || activeWhatsAppIdRef.current !== incomingConv.id)
            ) {
              try {
                const n = new Notification(`WhatsApp • ${incomingConv.contactName}`, {
                  body: incomingMsg.text
                });
                n.onclick = () => {
                  window.focus();
                  setActiveWhatsAppId(incomingConv.id);
                  setCurrentTab('whatsapp');
                  n.close();
                };
              } catch {
                // ignore desktop notification errors
              }
            }
          }
        }
      } catch {
        // ignore malformed realtime frame
      }
    };

    const scheduleReconnect = (preferSse: boolean) => {
      if (disposed || reconnectTimer) return;
      attempt += 1;
      const delayMs = Math.min(10000, 1000 * Math.pow(1.5, Math.min(attempt, 5)));
      setRealtimeStatus('connecting');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (preferSse) {
          connectSse();
        } else {
          connectWebSocket();
        }
      }, delayMs);
    };

    const connectSse = () => {
      if (disposed) return;
      const token = getStoredSessionToken();
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      try {
        sse = new EventSource(`/api/whatsapp/stream${query}`, { withCredentials: true });
      } catch {
        scheduleReconnect(true);
        return;
      }

      sse.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setRealtimeStatus('sse');
      };

      sse.onmessage = (ev) => {
        if (disposed) return;
        handleRealtimeEvent(ev.data);
      };

      sse.onerror = () => {
        if (disposed) return;
        sse?.close();
        sse = null;
        scheduleReconnect(true);
      };
    };

    const connectWebSocket = () => {
      if (disposed) return;
      setRealtimeStatus('connecting');
      const token = getStoredSessionToken();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      const wsUrl = `${protocol}//${window.location.host}/ws/whatsapp${query}`;

      let opened = false;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        connectSse();
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        opened = true;
        attempt = 0;
        setRealtimeStatus('ws');
      };

      ws.onmessage = (ev) => {
        if (disposed || typeof ev.data !== 'string') return;
        handleRealtimeEvent(ev.data);
      };

      ws.onerror = () => {
        // handled in onclose
      };

      ws.onclose = () => {
        if (disposed) return;
        ws = null;
        if (!opened) {
          connectSse();
        } else {
          scheduleReconnect(false);
        }
      };
    };

    connectWebSocket();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      if (sse) {
        try {
          sse.close();
        } catch {
          // ignore
        }
      }
    };
  }, [currentUser?.id, canReadWhatsApp, playNotificationChime]);

  // Real-time Firestore onSnapshot listeners for WhatsApp Conversations & Logs (20i PHP -> Firestore -> CRM UI)
  useEffect(() => {
    if (!currentUser || !canReadWhatsApp || !firebaseUser?.emailVerified) {
      firestoreConvInitRef.current = false;
      lastSeenFsTimestampsRef.current.clear();
      hydratedMsgConvIdsRef.current.clear();
      setFirestoreLogs([]);
      return;
    }

    const workspaceId = firebaseUser.uid;
    firestoreConvInitRef.current = false;

    const unsubConvs = subscribeWhatsAppConversationsFromFirestore(workspaceId, {
      onConversations: (remoteConvs) => {
        if (remoteConvs.length > 0) {
          setRealtimeStatus((prev) => (prev === 'ws' ? 'ws' : 'sse'));
        }

        const isFirst = !firestoreConvInitRef.current;
        firestoreConvInitRef.current = true;

        const newlyUpdated: WhatsAppConversation[] = [];
        for (const rc of remoteConvs) {
          const ts = Date.parse(rc.lastMessageTimestamp || '') || 0;
          const prevTs = lastSeenFsTimestampsRef.current.get(rc.id) || 0;
          if (!isFirst && ts > prevTs) {
            newlyUpdated.push(rc);
          }
          if (ts > prevTs) {
            lastSeenFsTimestampsRef.current.set(rc.id, ts);
          }
        }

        setWhatsappConversations((prev) => {
          const prevMap = new Map<string, WhatsAppConversation>();
          for (const p of prev) {
            prevMap.set(p.id, p);
          }

          const mergedList: WhatsAppConversation[] = [];
          const seenIds = new Set<string>();

          for (const rc of remoteConvs) {
            seenIds.add(rc.id);
            const existing = prevMap.get(rc.id);
            if (!existing) {
              mergedList.push(rc);
            } else {
              const remoteTs = Date.parse(rc.lastMessageTimestamp || '') || 0;
              const localTs = Date.parse(existing.lastMessageTimestamp || '') || 0;
              const preferRemote = remoteTs >= localTs;
              mergedList.push({
                ...existing,
                ...(preferRemote
                  ? {
                      contactName: rc.contactName || existing.contactName,
                      contactPhone: rc.contactPhone || existing.contactPhone,
                      waId: rc.waId ?? existing.waId,
                      phoneNumberId: rc.phoneNumberId ?? existing.phoneNumberId,
                      conversationKey: rc.conversationKey ?? existing.conversationKey,
                      status: rc.status,
                      aiPaused: Boolean(rc.aiPaused),
                      assignedAgent: rc.assignedAgent || existing.assignedAgent,
                      assignedUserId: rc.assignedUserId ?? existing.assignedUserId,
                      lastMessage: rc.lastMessage || existing.lastMessage,
                      lastMessageTimestamp: rc.lastMessageTimestamp || existing.lastMessageTimestamp,
                      lastInboundAt: rc.lastInboundAt || existing.lastInboundAt,
                      unreadCount: rc.unreadCount,
                      leadId: rc.leadId ?? existing.leadId,
                      clientId: rc.clientId ?? existing.clientId,
                      closedAt: rc.closedAt ?? existing.closedAt,
                      closedBy: rc.closedBy ?? existing.closedBy
                    }
                  : {}),
                messages: existing.messages || [],
                handoverHistory: existing.handoverHistory || []
              });
            }
          }

          for (const p of prev) {
            if (!seenIds.has(p.id)) {
              mergedList.push(p);
            }
          }

          mergedList.sort(
            (a, b) =>
              new Date(b.lastMessageTimestamp || 0).getTime() -
              new Date(a.lastMessageTimestamp || 0).getTime()
          );
          return mergedList;
        });

        setActiveWhatsAppId((prev) => prev || remoteConvs[0]?.id || '');

        // Pre-fetch messages once for newly observed conversations so thread preview/history is ready
        for (const rc of remoteConvs.slice(0, 12)) {
          if (!hydratedMsgConvIdsRef.current.has(rc.id)) {
            hydratedMsgConvIdsRef.current.add(rc.id);
            fetchWhatsAppMessagesOnceFromFirestore(workspaceId, rc.id)
              .then(({ messages, handovers }) => {
                if (messages.length === 0 && handovers.length === 0) return;
                setWhatsappConversations((prev) =>
                  prev.map((c) => {
                    if (c.id !== rc.id) return c;
                    const existingIds = new Set(c.messages.map((m) => m.metaMessageId || m.id));
                    const mergedMsgs = [...c.messages];
                    for (const m of messages) {
                      const key = m.metaMessageId || m.id;
                      if (!existingIds.has(key)) mergedMsgs.push(m);
                    }
                    mergedMsgs.sort(
                      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
                    );
                    const existingHoIds = new Set((c.handoverHistory || []).map((h) => h.id));
                    const mergedHo = [...(c.handoverHistory || [])];
                    for (const h of handovers) {
                      if (!existingHoIds.has(h.id)) mergedHo.push(h);
                    }
                    mergedHo.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
                    return { ...c, messages: mergedMsgs, handoverHistory: mergedHo };
                  })
                );
                api
                  .hydrateWhatsAppFromFirestore({
                    activeConversationId: rc.id,
                    messages,
                    handovers
                  })
                  .catch(() => {});
              })
              .catch(() => {});
          }
        }

        // Notify user if an inbound/updated conversation arrived outside active view
        const alertConv = newlyUpdated.find((c) => (c.unreadCount || 0) > 0);
        if (alertConv) {
          const isViewingThisChat =
            currentTabRef.current === 'whatsapp' &&
            activeWhatsAppIdRef.current === alertConv.id &&
            typeof document !== 'undefined' &&
            !document.hidden;

          playNotificationChime();
          if (!isViewingThisChat) {
            setWaNotification({
              id: `fs_${alertConv.id}_${Date.now()}`,
              conversationId: alertConv.id,
              contactName: alertConv.contactName,
              text: alertConv.lastMessage,
              timestamp: alertConv.lastMessageTimestamp
            });
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => {
              setWaNotification(null);
            }, 7000);
          }
        }

        if (remoteConvs.length > 0) {
          api.hydrateWhatsAppFromFirestore({ conversations: remoteConvs }).catch(() => {});
        }
      },
      onError: () => {
        // Silent fallback if Firestore rules block unlinked session
      }
    });

    const unsubLogs = subscribeWhatsAppLogsFromFirestore(workspaceId, {
      onLogs: (logs) => {
        setFirestoreLogs(logs);
        if (logs.length > 0) {
          api.hydrateWhatsAppFromFirestore({ logs }).catch(() => {});
        }
      },
      onError: () => {}
    });

    return () => {
      unsubConvs();
      unsubLogs();
    };
  }, [currentUser?.id, canReadWhatsApp, firebaseUser?.uid, firebaseUser?.emailVerified, playNotificationChime]);

  // Real-time Firestore listener for the currently selected WhatsApp conversation's messages & handover trail
  useEffect(() => {
    if (!currentUser || !canReadWhatsApp || !firebaseUser?.emailVerified || !activeWhatsAppId) {
      return;
    }

    const workspaceId = firebaseUser.uid;
    const targetConvId = activeWhatsAppId;

    const unsubActive = subscribeWhatsAppMessagesFromFirestore(workspaceId, targetConvId, {
      onMessages: (msgs) => {
        if (msgs.length === 0) return;
        setWhatsappConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
            const byKey = new Map<string, WhatsAppConversation['messages'][number]>();
            for (const m of c.messages) {
              byKey.set(m.metaMessageId ? `w:${m.metaMessageId}` : `i:${m.id}`, m);
            }
            for (const m of msgs) {
              const key = m.metaMessageId ? `w:${m.metaMessageId}` : `i:${m.id}`;
              const prevMsg = byKey.get(key);
              if (!prevMsg) {
                byKey.set(key, m);
              } else {
                const prevRank = STATUS_RANK[prevMsg.status || 'sent'] ?? 1;
                const nextRank = STATUS_RANK[m.status || 'sent'] ?? 1;
                byKey.set(key, {
                  ...prevMsg,
                  ...m,
                  id: prevMsg.id,
                  status: nextRank >= prevRank ? m.status : prevMsg.status
                });
              }
            }
            const merged = Array.from(byKey.values()).sort(
              (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
            );
            const last = merged[merged.length - 1];
            const prevTs = Date.parse(c.lastMessageTimestamp || '') || 0;
            const lastTs = last ? Date.parse(last.timestamp || '') || 0 : 0;
            return {
              ...c,
              messages: merged,
              ...(last && lastTs >= prevTs
                ? { lastMessage: last.text, lastMessageTimestamp: last.timestamp }
                : {})
            };
          })
        );
        api
          .hydrateWhatsAppFromFirestore({ activeConversationId: targetConvId, messages: msgs })
          .catch(() => {});
      },
      onHandovers: (hos) => {
        if (hos.length === 0) return;
        setWhatsappConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            const byId = new Map<string, NonNullable<WhatsAppConversation['handoverHistory']>[number]>();
            for (const h of c.handoverHistory || []) byId.set(h.id, h);
            for (const h of hos) byId.set(h.id, h);
            const mergedHo = Array.from(byId.values()).sort(
              (a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()
            );
            return { ...c, handoverHistory: mergedHo };
          })
        );
        api
          .hydrateWhatsAppFromFirestore({ activeConversationId: targetConvId, handovers: hos })
          .catch(() => {});
      },
      onError: () => {}
    });

    return () => {
      unsubActive();
    };
  }, [currentUser?.id, canReadWhatsApp, firebaseUser?.uid, firebaseUser?.emailVerified, activeWhatsAppId]);

  const handleAuthenticated = useCallback((user: User, perms: string[]) => {
    try {
      localStorage.removeItem(MANUAL_LOGOUT_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    autoResumeAttemptedRef.current = false;
    restoredFromFirestoreRef.current = false;
    restoringFromCloudRef.current = false;
    setCloudRestoreComplete(false);
    setSessionNotice(null);
    setGlobalError(null);
    setNeedsAdminSetup(false);
    setCurrentUser(user);
    setPermissions(perms);
    setCurrentTab('dashboard');
  }, []);

  // Automatically resume verified Firebase Google session if server restarted/reset cleanly
  useEffect(() => {
    if (authChecking || !firebaseAuthReady || currentUser) return;
    if (!firebaseUser?.emailVerified) return;
    try {
      if (localStorage.getItem(MANUAL_LOGOUT_STORAGE_KEY)) return;
    } catch {
      // continue if localStorage unavailable
    }
    if (autoResumeAttemptedRef.current) return;

    autoResumeAttemptedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await firebaseUser.getIdToken();
        let res;
        if (needsAdminSetup) {
          try {
            res = await api.setupAdminWithGoogle(idToken);
          } catch (err: any) {
            if (err?.code === 'ADMIN_ALREADY_EXISTS' || String(err?.message || '').includes('já existe')) {
              res = await api.loginWithGoogle(idToken);
            } else {
              throw err;
            }
          }
        } else {
          res = await api.loginWithGoogle(idToken);
        }
        if (!cancelled && res?.user) {
          handleAuthenticated(res.user, res.permissions || []);
        }
      } catch {
        // Leave LoginScreen visible if silent Google session resume isn't applicable
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecking, firebaseAuthReady, currentUser, firebaseUser, needsAdminSetup, handleAuthenticated]);

  const handleLogout = async () => {
    try {
      localStorage.setItem(MANUAL_LOGOUT_STORAGE_KEY, '1');
    } catch {
      // ignore storage errors
    }
    dataReadyRef.current = false;
    restoredFromFirestoreRef.current = false;
    restoringFromCloudRef.current = false;
    setCloudRestoreComplete(false);
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setCurrentUser(null);
    setPermissions([]);
    setLeads([]);
    setProspects([]);
    setClients([]);
    setProposals([]);
    setProjects([]);
    setFinancial([]);
    setSupportTickets([]);
    setWhatsappConversations([]);
    setWhatsappAttendants([]);
    setSelectedClientIdFromWhatsApp(null);
    setUsers([]);
    try {
      const session = await api.getSession();
      setNeedsAdminSetup(session.needsAdminSetup);
    } catch {
      setNeedsAdminSetup(false);
    }
  };

  const reportError = useCallback((err: any, fallback: string) => {
    const msg = err?.message || fallback;
    setGlobalError(msg);
  }, []);

  const handleMarkWhatsAppRead = useCallback(async (convId: string) => {
    let targetConv: WhatsAppConversation | undefined;
    setWhatsappConversations((prev) =>
      prev.map((c) => {
        if (c.id === convId) {
          targetConv = { ...c, unreadCount: 0 };
          return targetConv;
        }
        return c;
      })
    );
    try {
      const updated = await api.markWhatsAppConversationRead(convId);
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid && (updated || targetConv)) {
        upsertWhatsAppConversationInFirestore(fbUid, updated || targetConv!).catch(() => {});
      }
    } catch {
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid && targetConv) {
        upsertWhatsAppConversationInFirestore(fbUid, targetConv).catch(() => {});
      }
    }
  }, []);

  const unreadWhatsApp = whatsappConversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title =
      unreadWhatsApp > 0
        ? `(${unreadWhatsApp}) FMWS SALES AI — CRM & WhatsApp`
        : 'FMWS SALES AI — CRM & Inteligência Comercial';
  }, [unreadWhatsApp]);

  const handleScanWhatsAppDuplicates = useCallback(async (): Promise<WhatsAppDuplicateGroupPreview[]> => {
    const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
    if (!fbUid) {
      setDuplicateGroups([]);
      return [];
    }
    setScanningDuplicates(true);
    try {
      const groups = await scanDuplicateWhatsAppConversationsInFirestore(
        fbUid,
        integrations?.metaCloud?.phoneNumberId
      );
      setDuplicateGroups(groups);
      return groups;
    } catch (err) {
      reportError(err, 'Falha ao verificar conversas duplicadas no Firestore.');
      return [];
    } finally {
      setScanningDuplicates(false);
    }
  }, [integrations?.metaCloud?.phoneNumberId, reportError]);

  const handleMergeDuplicateWhatsAppGroup = useCallback(
    async (group: WhatsAppDuplicateGroupPreview) => {
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (!fbUid) {
        setGlobalError('Autentique sua conta Google no Firebase antes de unificar conversas.');
        return;
      }
      setMergingDuplicateKey(group.groupKey);
      try {
        const { mergedConversation, removedIds } = await mergeDuplicateWhatsAppGroupInFirestore(
          fbUid,
          group,
          currentUser?.name || 'Operador CRM'
        );

        await api.mergeWhatsAppDuplicatesLocal(mergedConversation, removedIds).catch(() => {});

        for (const rid of removedIds) {
          hydratedMsgConvIdsRef.current.delete(rid);
        }
        hydratedMsgConvIdsRef.current.add(mergedConversation.id);

        setWhatsappConversations((prev) => {
          const removedSet = new Set(removedIds);
          const filtered = prev.filter((c) => !removedSet.has(c.id) && c.id !== mergedConversation.id);
          return [mergedConversation, ...filtered].sort(
            (a, b) =>
              new Date(b.lastMessageTimestamp || 0).getTime() -
              new Date(a.lastMessageTimestamp || 0).getTime()
          );
        });
        setActiveWhatsAppId(mergedConversation.id);
        setDuplicateGroups((prev) => prev.filter((g) => g.groupKey !== group.groupKey));
      } catch (err) {
        reportError(err, 'Falha ao unificar conversas duplicadas.');
        throw err;
      } finally {
        setMergingDuplicateKey(null);
      }
    },
    [currentUser?.name, reportError]
  );

  // Silent read-only scan on WhatsApp tab entry when Firebase is connected
  useEffect(() => {
    if (!currentUser || !canReadWhatsApp || !firebaseUser?.emailVerified) return;
    if (currentTab !== 'whatsapp') return;
    handleScanWhatsAppDuplicates();
  }, [currentUser, canReadWhatsApp, firebaseUser?.emailVerified, firebaseUser?.uid, currentTab, handleScanWhatsAppDuplicates]);

  // Show loading screen during session check
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#090B10] flex flex-col items-center justify-center gap-3 text-slate-300">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4A72C] to-[#7A5B0B] p-[1.5px] flex items-center justify-center">
          <div className="w-full h-full bg-[#090B10] rounded-[10px] flex items-center justify-center">
            <span className="font-black text-[#D4A72C] text-xs">FMWS</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <RefreshCw size={14} className="animate-spin text-[#D4A72C]" />
          <span>Verificando autenticação...</span>
        </div>
      </div>
    );
  }

  // Block unauthenticated users behind LoginScreen
  if (!currentUser) {
    return (
      <LoginScreen
        needsAdminSetup={needsAdminSetup}
        sessionNotice={sessionNotice}
        onAuthenticated={handleAuthenticated}
        onRequireSessionRefresh={refreshSession}
      />
    );
  }

  // Quick Action Handler from Navbar
  const handleQuickAction = (action: 'lead' | 'proposal' | 'ticket' | 'prospect') => {
    if (action === 'lead') {
      setEditingLead(null);
      setLeadModalOpen(true);
    } else if (action === 'proposal') {
      setInitialLeadForProposal(null);
      setProposalModalOpen(true);
    } else if (action === 'ticket') {
      setInitialClientForTicket(null);
      setTicketModalOpen(true);
    } else if (action === 'prospect') {
      setCurrentTab('prospecting');
    }
  };

  // Kanban Stage Customizers
  const handleSaveCrmStages = async (stages: KanbanStageConfig[]) => {
    const saved = await api.saveCrmStages(stages);
    setCrmStages(saved);
    if (!restoringFromCloudRef.current) {
      await syncNowToFirestore();
    }
  };

  const handleSaveProjectStages = async (stages: KanbanStageConfig[]) => {
    const saved = await api.saveProjectStages(stages);
    setProjectStages(saved);
    if (!restoringFromCloudRef.current) {
      await syncNowToFirestore();
    }
  };

  // Lead Actions
  const handleSaveLead = async (leadData: Partial<Lead>) => {
    try {
      if (leadData.id) {
        const updated = await api.updateLead(leadData.id, leadData);
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await api.createLead(leadData);
        setLeads((prev) => [created, ...prev]);
      }
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao salvar lead no banco de dados.');
      throw err;
    }
  };

  const handleUpdateLeadStatus = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const updated = await api.updateLead(leadId, { status: newStatus });
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
    } catch (err) {
      reportError(err, 'Falha ao mover lead no funil.');
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    try {
      await api.deleteLead(leadId);
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
    } catch (err) {
      reportError(err, 'Falha ao excluir lead.');
    }
  };

  const handleApproveColdOutreach = async (leadId: string, pitchText: string) => {
    try {
      const res = await api.approveOutreach(leadId, pitchText, currentUser.name);
      if (res.lead) {
        setLeads((prev) => prev.map((l) => (l.id === leadId ? res.lead : l)));
      }
      if (res.conversation) {
        setWhatsappConversations((prev) => {
          const exists = prev.some((c) => c.id === res.conversation.id);
          return exists
            ? prev.map((c) => (c.id === res.conversation.id ? res.conversation : c))
            : [res.conversation, ...prev];
        });
        setActiveWhatsAppId(res.conversation.id);
        setCurrentTab('whatsapp');
        const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
        if (fbUid) {
          upsertWhatsAppConversationInFirestore(
            fbUid,
            res.conversation,
            res.conversation.messages?.[0] || null
          ).catch(() => {});
        }
      }
    } catch (err) {
      reportError(err, 'Falha ao aprovar abordagem comercial.');
    }
  };

  const handleConvertToClient = async (lead: Lead) => {
    try {
      const newClientData: Partial<Client> = {
        leadId: lead.id,
        companyName: lead.company,
        tradeName: lead.company,
        cnpjCpf: '',
        contactName: lead.name,
        email: lead.email,
        phone: lead.phone,
        whatsapp: lead.whatsapp,
        city: lead.city,
        state: lead.state,
        address: lead.address || '',
        status: 'ativo',
        contractStart: new Date().toISOString().substring(0, 10),
        mrr: 0,
        notes: 'Cliente convertido a partir do lead no CRM.',
        services: []
      };

      const created = await api.createClient(newClientData);
      setClients((prev) => [created, ...prev]);
      setCurrentTab('clients');
    } catch (err) {
      reportError(err, 'Falha ao converter lead em cliente.');
    }
  };


  // WhatsApp Actions
  const handleOpenWhatsAppByPhone = async (phone: string) => {
    const clean = phone.replace(/\D/g, '');
    if (!clean) {
      setGlobalError('Telefone/WhatsApp inválido para iniciar atendimento.');
      return;
    }
    const existing = whatsappConversations.find(
      (c) => whatsAppPhonesMatch(c.waId || c.contactPhone, clean)
    );
    if (existing) {
      setActiveWhatsAppId(existing.id);
      setCurrentTab('whatsapp');
      return;
    }

    try {
      const lead = leads.find((l) => whatsAppPhonesMatch(l.whatsapp || l.phone || '', clean));
      const client = clients.find((c) => whatsAppPhonesMatch(c.whatsapp || c.phone || '', clean));
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      const created = await api.createWhatsAppConversation({
        phone: clean,
        phoneNumberId: integrations?.metaCloud?.phoneNumberId,
        workspaceId: fbUid || undefined,
        contactName: lead
          ? `${lead.name} (${lead.company})`
          : client
          ? `${client.contactName} (${client.tradeName || client.companyName})`
          : undefined,
        leadId: lead?.id,
        clientId: client?.id
      });
      setWhatsappConversations((prev) => {
        const exists = prev.some((c) => c.id === created.id);
        return exists ? prev : [created, ...prev];
      });
      setActiveWhatsAppId(created.id);
      setCurrentTab('whatsapp');
      if (fbUid) {
        upsertWhatsAppConversationInFirestore(fbUid, created).catch(() => {});
      }
    } catch (err) {
      reportError(err, 'Falha ao iniciar conversa no WhatsApp.');
    }
  };

  const handleSendWhatsAppMessage = async (convId: string, text: string) => {
    try {
      const currentConv = whatsappConversations.find((c) => c.id === convId);
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      const effectivePid = currentConv?.phoneNumberId || integrations?.metaCloud?.phoneNumberId;
      const res = await api.sendWhatsAppMessage(convId, text, currentUser.name, {
        contactPhone: currentConv?.waId || currentConv?.contactPhone,
        contactName: currentConv?.contactName,
        phoneNumberId: effectivePid,
        workspaceId: fbUid || undefined
      });
      if (res?.conversation) {
        const savedConv = res.conversation as WhatsAppConversation;
        setWhatsappConversations((prev) => {
          const hasSaved = prev.some((c) => c.id === savedConv.id || c.id === convId);
          return hasSaved
            ? prev.map((c) => (c.id === savedConv.id || c.id === convId ? savedConv : c))
            : [savedConv, ...prev];
        });
        if (savedConv.id !== convId) {
          setActiveWhatsAppId(savedConv.id);
        }
        if (fbUid) {
          upsertWhatsAppConversationInFirestore(fbUid, savedConv, res.message || null).catch(() => {});
        }
      }
    } catch (err) {
      reportError(err, 'Falha ao enviar mensagem WhatsApp.');
      throw err;
    }
  };

  const handleSendWhatsAppTemplate = async (payload: {
    conversationId: string;
    templateName: string;
    languageCode?: string;
    bodyParams?: string[];
    previewText?: string;
  }) => {
    try {
      const currentConv = whatsappConversations.find((c) => c.id === payload.conversationId);
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      const res = await api.sendWhatsAppTemplate({
        ...payload,
        phoneNumberId: currentConv?.phoneNumberId || integrations?.metaCloud?.phoneNumberId,
        workspaceId: fbUid || undefined
      });
      if (res?.conversation) {
        const savedConv = res.conversation as WhatsAppConversation;
        setWhatsappConversations((prev) =>
          prev.map((c) =>
            c.id === savedConv.id || c.id === payload.conversationId ? savedConv : c
          )
        );
        if (fbUid) {
          upsertWhatsAppConversationInFirestore(fbUid, savedConv, res.message || null).catch(() => {});
        }
      }
    } catch (err) {
      reportError(err, 'Falha ao enviar Template via Meta API.');
      throw err;
    }
  };

  const handleSimulateIncomingWhatsApp = async (convId: string, text: string) => {
    try {
      const res = await api.simulateIncomingWhatsApp(convId, text);
      if (res?.conversation) {
        const updatedConv = res.conversation as WhatsAppConversation;
        setWhatsappConversations((prev) =>
          prev.map((c) => (c.id === convId ? updatedConv : c))
        );
        const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
        if (fbUid) {
          const lastTwo = updatedConv.messages.slice(-2);
          for (const msg of lastTwo) {
            await upsertWhatsAppConversationInFirestore(fbUid, updatedConv, msg).catch(() => {});
          }
          if (lastTwo.length === 0) {
            upsertWhatsAppConversationInFirestore(fbUid, updatedConv).catch(() => {});
          }
        }
      }
    } catch (err) {
      reportError(err, 'Falha ao processar mensagem recebida.');
    }
  };

  const handleToggleHandover = async (
    convId: string,
    status: 'ai_active' | 'human_takeover',
    agent: 'Atendente IA' | 'Humano'
  ) => {
    try {
      const updated = await api.setWhatsAppHandover(convId, status, agent);
      setWhatsappConversations((prev) => prev.map((c) => (c.id === convId ? updated : c)));
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid) {
        const latestHo = updated.handoverHistory?.[updated.handoverHistory.length - 1] || null;
        upsertWhatsAppConversationInFirestore(fbUid, updated, null, latestHo).catch(() => {});
      }
    } catch (err) {
      reportError(err, 'Falha ao transferir atendimento.');
    }
  };

  const handleUpdateWhatsAppHandover = async (
    convId: string,
    payload: {
      status?: 'ai_active' | 'human_takeover' | 'resolved';
      assignedAgent?: string;
      assignedUserId?: string;
      aiPaused?: boolean;
      note?: string;
    }
  ) => {
    try {
      const updated = await api.setWhatsAppHandover(convId, payload);
      setWhatsappConversations((prev) => prev.map((c) => (c.id === convId ? updated : c)));
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid && !restoringFromCloudRef.current) {
        const latestHo = updated.handoverHistory?.[updated.handoverHistory.length - 1] || null;
        await upsertWhatsAppConversationInFirestore(fbUid, updated, null, latestHo);
      }
    } catch (err) {
      reportError(err, 'Falha ao atualizar controle de atendimento WhatsApp.');
      throw err;
    }
  };

  const handleLinkWhatsAppConversation = async (
    convId: string,
    payload: { leadId?: string; clientId?: string; contactName?: string }
  ) => {
    try {
      const updated = await api.linkWhatsAppConversation(convId, payload);
      setWhatsappConversations((prev) => prev.map((c) => (c.id === convId ? updated : c)));
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid && !restoringFromCloudRef.current) {
        const latestHo = updated.handoverHistory?.[updated.handoverHistory.length - 1] || null;
        await upsertWhatsAppConversationInFirestore(fbUid, updated, null, latestHo);
      }
    } catch (err) {
      reportError(err, 'Falha ao vincular conversa ao lead ou cliente.');
      throw err;
    }
  };

  const handleCreateLeadFromWhatsApp = async (
    convId: string,
    payload?: { name?: string; company?: string; email?: string; segment?: string }
  ) => {
    try {
      const res = await api.createLeadFromWhatsApp(convId, payload);
      if (res?.lead) {
        setLeads((prev) => (prev.some((l) => l.id === res.lead.id) ? prev : [res.lead, ...prev]));
      }
      if (res?.conversation) {
        setWhatsappConversations((prev) =>
          prev.map((c) => (c.id === convId ? res.conversation : c))
        );
        const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
        if (fbUid && !restoringFromCloudRef.current) {
          const latestHo =
            res.conversation.handoverHistory?.[res.conversation.handoverHistory.length - 1] || null;
          await upsertWhatsAppConversationInFirestore(fbUid, res.conversation, null, latestHo);
        }
      }
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao criar lead a partir do WhatsApp.');
      throw err;
    }
  };

  const handleOpenClientProfileFromWhatsApp = (clientId: string) => {
    setSelectedClientIdFromWhatsApp(clientId);
    setCurrentTab('clients');
  };

  const handleDeleteWhatsAppConversation = async (convId: string) => {
    try {
      await api.deleteWhatsAppConversation(convId);
      setWhatsappConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== convId);
        if (activeWhatsAppId === convId) {
          setActiveWhatsAppId(remaining[0]?.id || '');
        }
        return remaining;
      });
      const fbUid = firebaseAuth.currentUser?.emailVerified ? firebaseAuth.currentUser.uid : '';
      if (fbUid && !restoringFromCloudRef.current) {
        await deleteWhatsAppConversationInFirestore(fbUid, convId);
      }
    } catch (err) {
      reportError(err, 'Falha ao excluir conversa do WhatsApp.');
      throw err;
    }
  };

  // Client Actions
  const handleSaveClient = async (clientData: Partial<Client>) => {
    try {
      if (clientData.id) {
        const updated = await api.updateClient(clientData.id, clientData);
        setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await api.createClient(clientData);
        setClients((prev) => [created, ...prev]);
      }
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao salvar cliente.');
      throw err;
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    try {
      await api.deleteClient(clientId);
      setClients((prev) => prev.filter((c) => c.id !== clientId));
    } catch (err) {
      reportError(err, 'Falha ao excluir cliente.');
    }
  };

  // Proposals Actions
  const handleSaveProposal = async (proposalData: Partial<Proposal>) => {
    try {
      const created = await api.createProposal(proposalData);
      setProposals((prev) => [created, ...prev]);
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao criar proposta.');
    }
  };

  const handleApproveProposal = async (proposalId: string) => {
    try {
      const res = await api.approveProposal(proposalId, currentUser.name);
      if (res.proposal) {
        setProposals((prev) => prev.map((p) => (p.id === proposalId ? res.proposal : p)));
      }
    } catch (err) {
      reportError(err, 'Falha ao aprovar proposta.');
    }
  };

  const handleDeleteProposal = async (id: string) => {
    try {
      await api.deleteProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      reportError(err, 'Falha ao excluir proposta.');
    }
  };

  // Projects Actions
  const handleSaveProject = async (projectData: Partial<Project>) => {
    try {
      if (projectData.id) {
        const updated = await api.updateProject(projectData.id, projectData);
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const created = await api.createProject(projectData);
        setProjects((prev) => [created, ...prev]);
      }
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao salvar projeto.');
      throw err;
    }
  };

  const handleUpdateProjectStage = async (projectId: string, stage: ProjectStage) => {
    try {
      const updated = await api.updateProject(projectId, { stage });
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
    } catch (err) {
      reportError(err, 'Falha ao mover etapa do projeto.');
    }
  };

  const handleUpdateProject = async (
    projectId: string,
    payload: Partial<Project> & { historyAction?: string }
  ) => {
    try {
      const updated = await api.updateProject(projectId, payload);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
    } catch (err) {
      reportError(err, 'Falha ao atualizar projeto.');
      throw err;
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      reportError(err, 'Falha ao excluir projeto.');
    }
  };

  // Financial Actions
  const handleSaveTransaction = async (txData: Partial<FinancialTransaction>) => {
    try {
      const created = await api.createFinancial(txData);
      setFinancial((prev) => [created, ...prev]);
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao salvar lançamento financeiro.');
    }
  };

  const handleUpdateTransactionStatus = async (
    id: string,
    status: 'pago' | 'pendente' | 'atrasado'
  ) => {
    try {
      const updated = await api.updateFinancial(id, {
        status,
        paymentDate: status === 'pago' ? new Date().toISOString().substring(0, 10) : undefined
      });
      setFinancial((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      reportError(err, 'Falha ao atualizar status financeiro.');
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    try {
      await api.deleteFinancial(id);
      setFinancial((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      reportError(err, 'Falha ao excluir lançamento.');
    }
  };

  const handleSimulateAsaasPayment = async () => {
    if (integrations.asaas.status !== 'conectado') {
      setGlobalError(
        'Gateway Asaas não está configurado/conectado em Configurações. Configure sua API Key para operar cobranças reais.'
      );
      return;
    }
    const pendingTx = financial.find((f) => f.type === 'receita' && f.status !== 'pago');
    if (pendingTx) {
      await handleUpdateTransactionStatus(pendingTx.id, 'pago');
    }
  };

  // Support Tickets Actions
  const handleSaveTicket = async (ticketData: Partial<SupportTicket>) => {
    try {
      const created = await api.createSupportTicket(ticketData);
      setSupportTickets((prev) => [created, ...prev]);
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao registrar chamado.');
    }
  };

  const handleUpdateTicketStatus = async (ticketId: string, status: SupportTicket['status']) => {
    try {
      const updated = await api.updateSupportTicket(ticketId, {
        status,
        resolvedAt: status === 'resolvido' ? new Date().toISOString() : undefined
      });
      setSupportTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
    } catch (err) {
      reportError(err, 'Falha ao atualizar chamado.');
    }
  };

  const handleAddTicketNote = async (ticketId: string, text: string) => {
    try {
      const ticket = supportTickets.find((t) => t.id === ticketId);
      if (!ticket) return;
      const updatedNotes = [
        ...ticket.notes,
        {
          author: currentUser.name,
          text,
          createdAt: new Date().toISOString()
        }
      ];
      const updated = await api.updateSupportTicket(ticketId, { notes: updatedNotes });
      setSupportTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
    } catch (err) {
      reportError(err, 'Falha ao adicionar nota ao chamado.');
    }
  };

  // AI Agents Actions
  const handleUpdateAgent = async (agentId: string, updatedData: Partial<AIAgentConfig>) => {
    try {
      const updated = await api.updateAIAgent(agentId, updatedData);
      setAiAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)));
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao atualizar agente.');
      throw err;
    }
  };

  const handleRefreshAgentsAndIntegrations = (
    updatedAgent?: AIAgentConfig,
    updatedIntegrations?: SystemIntegrations
  ) => {
    if (updatedAgent) {
      setAiAgents((prev) => prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a)));
    }
    if (updatedIntegrations) {
      setIntegrations(updatedIntegrations);
    }
    if (!restoringFromCloudRef.current) {
      void syncNowToFirestore();
    }
  };

  // Settings & Users Actions
  const handleUpdateIntegrations = async (data: any) => {
    const updated = await api.updateIntegrations(data);
    setIntegrations(updated);
    if (data?.gemini?.syncAgents) {
      try {
        const freshAgents = await api.getAIAgents();
        setAiAgents(freshAgents);
      } catch {
        // ignore transient refresh failure
      }
    }
    if (
      !restoringFromCloudRef.current &&
      currentUser?.role === 'admin' &&
      firebaseAuth.currentUser?.emailVerified
    ) {
      await syncNowToFirestore();
    }
  };

  const handleIntegrationsUpdated = async (updated: SystemIntegrations) => {
    setIntegrations(updated);
    if (
      !restoringFromCloudRef.current &&
      currentUser?.role === 'admin' &&
      firebaseAuth.currentUser?.emailVerified
    ) {
      await syncNowToFirestore();
    }
  };

  const handleSaveService = async (service: Partial<ServiceProduct>) => {
    const saved = await api.saveService(service);
    setServices((prev) => {
      const exists = prev.some((s) => s.id === saved.id);
      return exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved];
    });
    if (!restoringFromCloudRef.current) {
      await syncNowToFirestore();
    }
  };

  const handleDeleteService = async (id: string) => {
    try {
      await api.deleteService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao excluir serviço.');
    }
  };

  const handleCreateUser = async (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    active?: boolean;
  }) => {
    const created = await api.createUser(payload);
    setUsers((prev) => [...prev, created]);
    if (!restoringFromCloudRef.current) {
      await syncNowToFirestore();
    }
  };

  const handleUpdateUser = async (id: string, payload: Partial<User> & { password?: string }) => {
    const updated = await api.updateUser(id, payload);
    setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    if (currentUser && updated.id === currentUser.id) {
      setCurrentUser(updated);
    }
    if (!restoringFromCloudRef.current) {
      await syncNowToFirestore();
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      if (!restoringFromCloudRef.current) {
        await syncNowToFirestore();
      }
    } catch (err) {
      reportError(err, 'Falha ao excluir usuário.');
    }
  };

  // Counters for sidebar badges
  const pendingProposals = proposals.filter((p) => p.status === 'aguardando_aprovacao').length;
  const openTickets = supportTickets.filter((t) => t.status !== 'resolvido').length;
  const pendingOutreach = leads.filter((l) => l.campaignStatus === 'pendente_aprovacao').length;

  const tabTitles: Record<string, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Dashboard Executivo',
      subtitle: 'Indicadores reais de oportunidades, vendas, atendimentos e financeiro'
    },
    crm: {
      title: 'CRM & Funil Comercial',
      subtitle: 'Kanban personalizável com arrastar e soltar, prioridades e histórico completo'
    },
    prospecting: {
      title: 'Prospecção, CSV & Auditoria Técnica',
      subtitle: 'Cadastro manual, importação CSV, deduplicação e verificação HTTP real de sites'
    },
    whatsapp: {
      title: 'WhatsApp Oficial (Meta Cloud API)',
      subtitle: 'Atendimento humanizado ou automatizado mediante credenciais configuradas'
    },
    clients: {
      title: 'Clientes & Hospedagens',
      subtitle: 'Base de clientes contratados, domínios e recorrência mensal (MRR)'
    },
    proposals: {
      title: 'Propostas Comerciais',
      subtitle: 'Editor de orçamentos, aprovação prévia, geração de PDF e histórico'
    },
    projects: {
      title: 'Projetos Web (Kanban)',
      subtitle: 'Etapas personalizáveis, tarefas reais, progresso calculado e entregas'
    },
    financial: {
      title: 'Financeiro & Asaas Gateway',
      subtitle: 'Receitas, despesas, boletos/PIX e conciliação de faturas'
    },
    support: {
      title: 'Suporte & Helpdesk',
      subtitle: 'Chamados técnicos de clientes com SLA e integração com WhatsApp'
    },
    ai_agents: {
      title: 'Funcionários de IA (Governança)',
      subtitle: 'Configuração de agentes vinculada às APIs oficiais e aprovação humana'
    },
    reports: {
      title: 'Relatórios & Business Intelligence',
      subtitle: 'Indicadores calculados exclusivamente sobre registros persistidos'
    },
    settings: {
      title: 'Configurações do Sistema',
      subtitle: 'Integrações seguras no servidor, serviços/preços e controle de usuários RBAC'
    }
  };

  return (
    <div className="flex h-screen bg-[#090B10] text-slate-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentUser={currentUser}
        permissions={permissions}
        onLogout={handleLogout}
        unreadWhatsApp={unreadWhatsApp}
        pendingProposals={pendingProposals}
        openTickets={openTickets}
        pendingOutreach={pendingOutreach}
        aiAgents={aiAgents}
        integrations={integrations}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar
          currentUser={currentUser}
          permissions={permissions}
          onLogout={handleLogout}
          onOpenQuickAction={handleQuickAction}
          title={tabTitles[currentTab]?.title || 'FMWS SALES AI'}
          subtitle={tabTitles[currentTab]?.subtitle}
          integrations={integrations}
          unreadWhatsApp={unreadWhatsApp}
          pendingOutreach={pendingOutreach}
          pendingProposals={pendingProposals}
          openTickets={openTickets}
          firebaseUser={firebaseUser}
          firestoreOnline={firestoreOnline}
          cloudSyncStatus={cloudSyncStatus}
          onConnectFirebase={handleConnectFirebase}
          onSyncFirestore={syncNowToFirestore}
          onPasswordChanged={async () => {
            setCurrentUser((prev) => (prev ? { ...prev, hasPassword: true } : prev));
            await syncNowToFirestore();
          }}
          onNavigate={setCurrentTab}
        />

        {/* Workspace Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {globalError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{globalError}</span>
              </div>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="text-rose-300 hover:text-white p-1 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {currentTab === 'dashboard' && (
            <DashboardModule
              metrics={metrics}
              leads={leads}
              clients={clients}
              whatsappConversations={whatsappConversations}
              proposals={proposals}
              projects={projects}
              financial={financial}
              supportTickets={supportTickets}
              aiAgents={aiAgents}
              integrations={integrations}
              onNavigate={setCurrentTab}
              onApproveOutreach={(lead) =>
                handleApproveColdOutreach(lead.id, lead.notes?.[0]?.text || '')
              }
            />
          )}

          {currentTab === 'crm' && hasPerm('crm.read') && (
            <CrmModule
              leads={leads}
              stages={crmStages}
              onSaveStages={handleSaveCrmStages}
              onOpenLeadModal={(lead) => {
                setEditingLead(lead || null);
                setLeadModalOpen(true);
              }}
              onUpdateLeadStatus={handleUpdateLeadStatus}
              onDeleteLead={handleDeleteLead}
              onOpenWhatsApp={handleOpenWhatsAppByPhone}
              onOpenProposalModal={(lead) => {
                setInitialLeadForProposal(lead);
                setProposalModalOpen(true);
              }}
              onConvertToClient={handleConvertToClient}
              loading={dataLoading}
              error={globalError}
            />
          )}

          {currentTab === 'prospecting' && hasPerm('prospecting.read') && (
            <ProspectingModule
              prospects={prospects}
              integrations={integrations}
              existingLeads={leads}
              currentUserName={currentUser.name}
              onProspectsChange={setProspects}
              onImportLeadToCrm={handleSaveLead}
              onOpenSettings={hasPerm('settings.read') ? () => setCurrentTab('settings') : undefined}
            />
          )}

          {currentTab === 'whatsapp' && hasPerm('whatsapp.read') && (
            <WhatsAppModule
              conversations={whatsappConversations}
              activeConversationId={activeWhatsAppId}
              integrations={integrations}
              leads={leads}
              clients={clients}
              attendants={whatsappAttendants}
              realtimeStatus={realtimeStatus}
              soundEnabled={soundEnabled}
              onToggleSound={() => setSoundEnabled((prev) => !prev)}
              onMarkConversationRead={handleMarkWhatsAppRead}
              onSelectConversation={(id) => {
                setActiveWhatsAppId(id);
                handleMarkWhatsAppRead(id);
              }}
              onSendMessage={handleSendWhatsAppMessage}
              onSendTemplate={handleSendWhatsAppTemplate}
              onSimulateIncoming={handleSimulateIncomingWhatsApp}
              onToggleHandover={handleToggleHandover}
              onUpdateHandover={handleUpdateWhatsAppHandover}
              onLinkConversation={handleLinkWhatsAppConversation}
              onCreateLeadFromWhatsApp={handleCreateLeadFromWhatsApp}
              onOpenClientProfile={handleOpenClientProfileFromWhatsApp}
              onDeleteConversation={handleDeleteWhatsAppConversation}
              duplicateGroups={duplicateGroups}
              scanningDuplicates={scanningDuplicates}
              mergingDuplicateKey={mergingDuplicateKey}
              firebaseWorkspaceId={firebaseUser?.emailVerified ? firebaseUser.uid : undefined}
              onScanDuplicates={handleScanWhatsAppDuplicates}
              onMergeDuplicateGroup={handleMergeDuplicateWhatsAppGroup}
            />
          )}

          {currentTab === 'clients' && hasPerm('clients.read') && (
            <ClientsModule
              clients={clients}
              catalogServices={services}
              selectedClientIdExternal={selectedClientIdFromWhatsApp}
              onOpenClientModal={(client) => {
                setEditingClient(client || null);
                setClientModalOpen(true);
              }}
              onSaveClient={handleSaveClient}
              onOpenWhatsApp={handleOpenWhatsAppByPhone}
              onOpenSupportTicket={(client) => {
                setInitialClientForTicket(client);
                setTicketModalOpen(true);
              }}
              onDeleteClient={handleDeleteClient}
              onOpenCatalogSettings={
                hasPerm('settings.read')
                  ? () => {
                      setSettingsInitialTab('services');
                      setCurrentTab('settings');
                    }
                  : undefined
              }
            />
          )}

          {currentTab === 'proposals' && hasPerm('proposals.read') && (
            <ProposalsModule
              proposals={proposals}
              onOpenNewProposal={() => {
                setInitialLeadForProposal(null);
                setProposalModalOpen(true);
              }}
              onApproveProposal={handleApproveProposal}
              onDeleteProposal={handleDeleteProposal}
              onSendWhatsApp={handleOpenWhatsAppByPhone}
            />
          )}

          {currentTab === 'projects' && hasPerm('projects.read') && (
            <ProjectsModule
              projects={projects}
              stages={projectStages}
              currentUserName={currentUser.name}
              onSaveStages={handleSaveProjectStages}
              onOpenProjectModal={(proj) => {
                setEditingProject(proj || null);
                setProjectModalOpen(true);
              }}
              onUpdateProjectStage={handleUpdateProjectStage}
              onUpdateProject={handleUpdateProject}
              onDeleteProject={handleDeleteProject}
              loading={dataLoading}
              error={globalError}
            />
          )}

          {currentTab === 'financial' && hasPerm('financial.read') && (
            <FinancialModule
              transactions={financial}
              onOpenTransactionModal={() => setTransactionModalOpen(true)}
              onUpdateStatus={handleUpdateTransactionStatus}
              onDeleteTransaction={handleDeleteTransaction}
              onSimulateAsaasPayment={handleSimulateAsaasPayment}
            />
          )}

          {currentTab === 'support' && hasPerm('support.read') && (
            <SupportModule
              tickets={supportTickets}
              onOpenNewTicket={() => {
                setInitialClientForTicket(null);
                setTicketModalOpen(true);
              }}
              onUpdateTicketStatus={handleUpdateTicketStatus}
              onAddNote={handleAddTicketNote}
              onOpenWhatsApp={handleOpenWhatsAppByPhone}
            />
          )}

          {currentTab === 'ai_agents' && hasPerm('agents.read') && (
            <AIAgentsModule
              agents={aiAgents}
              integrations={integrations}
              pendingLeads={leads.filter((l) => l.campaignStatus === 'pendente_aprovacao')}
              onUpdateAgent={handleUpdateAgent}
              onRefreshAgentsAndIntegrations={handleRefreshAgentsAndIntegrations}
              onApproveColdOutreach={handleApproveColdOutreach}
              firebaseUser={firebaseUser}
              firestoreOnline={firestoreOnline}
              cloudSyncStatus={cloudSyncStatus}
              onConnectFirebase={handleConnectFirebase}
              onSyncFirestore={syncNowToFirestore}
            />
          )}

          {currentTab === 'reports' && hasPerm('reports.read') && (
            <ReportsModule
              leads={leads}
              clients={clients}
              financial={financial}
              proposals={proposals}
              projects={projects}
              aiAgents={aiAgents}
            />
          )}

          {currentTab === 'settings' && hasPerm('settings.read') && (
            <SettingsModule
              integrations={integrations}
              services={services}
              users={users}
              currentUser={currentUser}
              initialTab={settingsInitialTab}
              firebaseWorkspaceId={firebaseUser?.emailVerified ? firebaseUser.uid : ''}
              firestoreWhatsAppLogs={firestoreLogs}
              onUpdateIntegrations={handleUpdateIntegrations}
              onIntegrationsUpdated={handleIntegrationsUpdated}
              onSaveService={handleSaveService}
              onDeleteService={handleDeleteService}
              onCreateUser={handleCreateUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              onCloudRestored={async () => {
                await loadAllData(permissions, currentUser.role);
              }}
            />
          )}
        </main>
      </div>

      {/* MODALS */}
      {leadModalOpen && (
        <LeadModal
          lead={editingLead}
          stages={crmStages}
          currentUserName={currentUser.name}
          onClose={() => setLeadModalOpen(false)}
          onSave={handleSaveLead}
          onDelete={handleDeleteLead}
        />
      )}

      {clientModalOpen && (
        <ClientModal
          client={editingClient}
          catalogServices={services}
          onOpenCatalogSettings={
            hasPerm('settings.read')
              ? () => {
                  setSettingsInitialTab('services');
                  setCurrentTab('settings');
                }
              : undefined
          }
          onClose={() => setClientModalOpen(false)}
          onSave={handleSaveClient}
        />
      )}

      {proposalModalOpen && (
        <ProposalModal
          initialLead={initialLeadForProposal}
          currentUserName={currentUser.name}
          onClose={() => setProposalModalOpen(false)}
          onSave={handleSaveProposal}
        />
      )}

      {projectModalOpen && (
        <ProjectModal
          project={editingProject}
          stages={projectStages}
          currentUserName={currentUser.name}
          onClose={() => setProjectModalOpen(false)}
          onSave={handleSaveProject}
          onDelete={handleDeleteProject}
        />
      )}

      {ticketModalOpen && (
        <TicketModal
          initialClient={initialClientForTicket}
          currentUserName={currentUser.name}
          onClose={() => setTicketModalOpen(false)}
          onSave={handleSaveTicket}
        />
      )}

      {transactionModalOpen && (
        <TransactionModal
          onClose={() => setTransactionModalOpen(false)}
          onSave={handleSaveTransaction}
        />
      )}

      {/* Floating Real-Time WhatsApp Toast Notification */}
      {waNotification && (
        <div className="fixed bottom-5 right-5 z-50 w-80 max-w-[calc(100vw-2rem)] bg-[#151926] border border-emerald-500/40 rounded-2xl shadow-2xl shadow-black/60 p-3.5 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                <MessageSquare size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Nova mensagem • WhatsApp
                </div>
                <div className="text-xs font-bold text-white truncate">
                  {waNotification.contactName}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWaNotification(null)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
              aria-label="Fechar notificação"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-slate-300 mt-2 line-clamp-2">{waNotification.text}</p>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setWaNotification(null)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold cursor-pointer"
            >
              Dispensar
            </button>
            <button
              type="button"
              onClick={() => {
                const targetId = waNotification.conversationId;
                setWaNotification(null);
                setActiveWhatsAppId(targetId);
                setCurrentTab('whatsapp');
                handleMarkWhatsAppRead(targetId);
              }}
              className="px-3 py-1 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-[11px] flex items-center gap-1 hover:brightness-110 cursor-pointer"
            >
              <span>Abrir conversa</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
