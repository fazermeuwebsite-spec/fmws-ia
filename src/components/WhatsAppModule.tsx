import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Bot,
  UserCheck,
  Sparkles,
  Search,
  Check,
  CheckCheck,
  Zap,
  Play,
  Trash2,
  AlertTriangle,
  AlertCircle,
  Volume2,
  VolumeX,
  BellRing,
  Radio,
  FileText,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Link2,
  Building2,
  UserPlus,
  History,
  CheckCircle2,
  Clock,
  RotateCcw,
  GitMerge,
  ShieldCheck
} from 'lucide-react';
import { WhatsAppConversation, SystemIntegrations, Lead, Client } from '../types';
import type { WhatsAppDuplicateGroupPreview } from '../firebase';
import { formatDateTimeBR } from '../utils/dateFormat';
import { api } from '../services/api';

interface WhatsAppModuleProps {
  conversations: WhatsAppConversation[];
  activeConversationId: string;
  integrations?: SystemIntegrations;
  leads?: Lead[];
  clients?: Client[];
  attendants?: Array<{ id: string; name: string; role: string }>;
  realtimeStatus?: 'ws' | 'sse' | 'connecting' | 'offline';
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onMarkConversationRead?: (conversationId: string) => void;
  onSelectConversation: (id: string) => void;
  onSendMessage: (conversationId: string, text: string) => Promise<void> | void;
  onSendTemplate?: (payload: {
    conversationId: string;
    templateName: string;
    languageCode?: string;
    bodyParams?: string[];
    previewText?: string;
  }) => Promise<void>;
  onSimulateIncoming: (conversationId: string, text: string) => void;
  onToggleHandover: (conversationId: string, newStatus: 'ai_active' | 'human_takeover', agent: 'Atendente IA' | 'Humano') => void;
  onUpdateHandover?: (
    conversationId: string,
    payload: {
      status?: 'ai_active' | 'human_takeover' | 'resolved';
      assignedAgent?: string;
      assignedUserId?: string;
      aiPaused?: boolean;
      note?: string;
    }
  ) => Promise<void> | void;
  onLinkConversation?: (
    conversationId: string,
    payload: { leadId?: string; clientId?: string; contactName?: string }
  ) => Promise<void> | void;
  onCreateLeadFromWhatsApp?: (
    conversationId: string,
    payload?: { name?: string; company?: string; email?: string; segment?: string }
  ) => Promise<void> | void;
  onOpenClientProfile?: (clientId: string) => void;
  onDeleteConversation?: (conversationId: string) => Promise<void> | void;
  duplicateGroups?: WhatsAppDuplicateGroupPreview[];
  scanningDuplicates?: boolean;
  mergingDuplicateKey?: string | null;
  firebaseWorkspaceId?: string;
  onScanDuplicates?: () => Promise<WhatsAppDuplicateGroupPreview[]>;
  onMergeDuplicateGroup?: (group: WhatsAppDuplicateGroupPreview) => Promise<void>;
}

function getWindow24hRemainingHours(lastInboundAt?: string): number | null {
  if (!lastInboundAt) return null;
  const ts = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = 24 * 60 * 60 * 1000 - (Date.now() - ts);
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (60 * 60 * 1000));
}

export const WhatsAppModule: React.FC<WhatsAppModuleProps> = ({
  conversations,
  activeConversationId,
  integrations,
  leads = [],
  clients = [],
  attendants = [],
  realtimeStatus = 'connecting',
  soundEnabled = true,
  onToggleSound,
  onMarkConversationRead,
  onSelectConversation,
  onSendMessage,
  onSendTemplate,
  onSimulateIncoming,
  onToggleHandover,
  onUpdateHandover,
  onLinkConversation,
  onCreateLeadFromWhatsApp,
  onOpenClientProfile,
  onDeleteConversation,
  duplicateGroups = [],
  scanningDuplicates = false,
  mergingDuplicateKey = null,
  firebaseWorkspaceId,
  onScanDuplicates,
  onMergeDuplicateGroup
}) => {
  const isMetaConnected = integrations?.metaCloud?.status === 'conectado';
  const [inputText, setInputText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [simulatedText, setSimulatedText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [linkLeadId, setLinkLeadId] = useState('');
  const [linkClientId, setLinkClientId] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [metaTemplates, setMetaTemplates] = useState<
    Array<{ name: string; status: string; language: string; category: string; bodyText?: string }>
  >([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState('hello_world');
  const [selectedTemplateLang, setSelectedTemplateLang] = useState('en_US');
  const [templateBodyParams, setTemplateBodyParams] = useState('');
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [convToDelete, setConvToDelete] = useState<WhatsAppConversation | null>(null);
  const [deletingConv, setDeletingConv] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [mergeSuccessMsg, setMergeSuccessMsg] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'ai' | 'human' | 'resolved'>('all');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) || conversations[0];

  const linkedLead = activeConv?.leadId
    ? leads.find((l) => l.id === activeConv.leadId)
    : undefined;
  const linkedClient = activeConv?.clientId
    ? clients.find((c) => c.id === activeConv.clientId)
    : activeConv
    ? clients.find((c) => {
        const cleanConv = activeConv.contactPhone.replace(/\D/g, '');
        const cleanCli = (c.whatsapp || c.phone || '').replace(/\D/g, '');
        return Boolean(cleanConv && cleanCli && cleanConv.endsWith(cleanCli.slice(-8)));
      })
    : undefined;

  const remainingHours24h = getWindow24hRemainingHours(activeConv?.lastInboundAt);
  const isWindowOpen = remainingHours24h !== null && remainingHours24h > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.id, activeConv?.messages.length]);

  useEffect(() => {
    if (activeConv && (activeConv.unreadCount || 0) > 0 && onMarkConversationRead) {
      onMarkConversationRead(activeConv.id);
    }
  }, [activeConv?.id, activeConv?.unreadCount, onMarkConversationRead]);

  const handleRequestDesktopNotification = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    } catch {
      // ignore if blocked by iframe policy
    }
  };

  const unreadTotalCount = conversations.filter((c) => (c.unreadCount || 0) > 0).length;
  const filteredConversations = conversations.filter((c) => {
    const cleanQuery = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !cleanQuery ||
      c.contactName.toLowerCase().includes(cleanQuery) ||
      c.contactPhone.includes(cleanQuery);
    if (!matchesSearch) return false;
    if (filterMode === 'unread') return (c.unreadCount || 0) > 0;
    if (filterMode === 'ai') return c.status === 'ai_active' && !c.aiPaused;
    if (filterMode === 'human') return c.status === 'human_takeover' || (c.status === 'ai_active' && Boolean(c.aiPaused));
    if (filterMode === 'resolved') return c.status === 'resolved';
    return true;
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || sendingMsg) return;
    const text = inputText.trim();
    setInputText('');
    setSendingMsg(true);
    try {
      await onSendMessage(activeConv.id, text);
    } catch {
      // error already shown by App globalError and failed bubble
    } finally {
      setSendingMsg(false);
    }
  };

  const handleOpenTemplateModal = async () => {
    setShowTemplateModal(true);
    setTemplatesError(null);
    setTemplatesLoading(true);
    try {
      const res = await api.getWhatsAppTemplates();
      const approved = (res.templates || []).filter((t) => t.status === 'APPROVED');
      const list = approved.length > 0 ? approved : res.templates || [];
      setMetaTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateName(list[0].name);
        setSelectedTemplateLang(list[0].language || 'pt_BR');
      }
    } catch (err: any) {
      setTemplatesError(err?.message || 'Não foi possível carregar os templates da Meta.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSendTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !onSendTemplate || !selectedTemplateName.trim()) return;
    setSendingTemplate(true);
    setTemplatesError(null);
    try {
      const paramsList = templateBodyParams
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const tplObj = metaTemplates.find((t) => t.name === selectedTemplateName);
      await onSendTemplate({
        conversationId: activeConv.id,
        templateName: selectedTemplateName.trim(),
        languageCode: selectedTemplateLang.trim() || 'pt_BR',
        bodyParams: paramsList.length > 0 ? paramsList : undefined,
        previewText: tplObj?.bodyText
          ? `[Template "${tplObj.name}"]: ${tplObj.bodyText}`
          : `[Template "${selectedTemplateName.trim()}" (${selectedTemplateLang.trim()})]`
      });
      setTemplateBodyParams('');
      setShowTemplateModal(false);
    } catch (err: any) {
      setTemplatesError(err?.message || 'Falha ao enviar Template pela Meta API.');
    } finally {
      setSendingTemplate(false);
    }
  };

  const handleSimulateSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatedText.trim() || !activeConv) return;
    onSimulateIncoming(activeConv.id, simulatedText.trim());
    setSimulatedText('');
    setShowSimulateModal(false);
  };

  const handleConfirmDeleteConversation = async () => {
    if (!convToDelete || !onDeleteConversation) return;
    setDeletingConv(true);
    try {
      await onDeleteConversation(convToDelete.id);
      setConvToDelete(null);
    } finally {
      setDeletingConv(false);
    }
  };

  const handleHandoverAction = async (payload: {
    status?: 'ai_active' | 'human_takeover' | 'resolved';
    assignedAgent?: string;
    assignedUserId?: string;
    aiPaused?: boolean;
    note?: string;
  }) => {
    if (!activeConv) return;
    if (onUpdateHandover) {
      await onUpdateHandover(activeConv.id, payload);
    } else if (payload.status && payload.status !== 'resolved') {
      onToggleHandover(
        activeConv.id,
        payload.status,
        payload.status === 'ai_active' ? 'Atendente IA' : 'Humano'
      );
    }
  };

  const handleOpenLinkModal = () => {
    if (!activeConv) return;
    setLinkLeadId(activeConv.leadId || '');
    setLinkClientId(activeConv.clientId || '');
    setShowLinkModal(true);
  };

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !onLinkConversation) return;
    setSavingLink(true);
    try {
      await onLinkConversation(activeConv.id, {
        leadId: linkLeadId || '',
        clientId: linkClientId || ''
      });
      setShowLinkModal(false);
    } finally {
      setSavingLink(false);
    }
  };

  const handleCreateLeadClick = async () => {
    if (!activeConv || !onCreateLeadFromWhatsApp) return;
    setCreatingLead(true);
    try {
      await onCreateLeadFromWhatsApp(activeConv.id);
    } finally {
      setCreatingLead(false);
    }
  };

  return (
    <div className="bg-[#11141E] border border-slate-800 rounded-xl overflow-hidden h-[calc(100vh-140px)] flex flex-col lg:flex-row shadow-xl">
      {/* LEFT: Conversation List */}
      <div className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col shrink-0 bg-[#0d1017]">
        {/* Header & Search */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isMetaConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="text-xs font-bold text-white uppercase tracking-wider truncate">WhatsApp Oficial</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                title={
                  realtimeStatus === 'ws'
                    ? 'Sincronização em tempo real via WebSocket'
                    : realtimeStatus === 'sse'
                    ? 'Sincronização em tempo real via Stream HTTP (SSE)'
                    : 'Reconectando ao canal em tempo real...'
                }
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                  realtimeStatus === 'ws' || realtimeStatus === 'sse'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : realtimeStatus === 'connecting'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                }`}
              >
                <Radio size={9} className={realtimeStatus === 'ws' || realtimeStatus === 'sse' ? 'animate-pulse' : ''} />
                <span>
                  {realtimeStatus === 'ws'
                    ? 'AO VIVO • WS'
                    : realtimeStatus === 'sse'
                    ? 'AO VIVO • SSE'
                    : realtimeStatus === 'connecting'
                    ? 'CONECTANDO'
                    : 'OFFLINE'}
                </span>
              </span>

              {onToggleSound && (
                <button
                  type="button"
                  onClick={onToggleSound}
                  title={soundEnabled ? 'Desativar som de novas mensagens' : 'Ativar som de novas mensagens'}
                  className={`p-1 rounded border text-[10px] transition-colors cursor-pointer ${
                    soundEnabled
                      ? 'bg-[#D4A72C]/15 text-[#D4A72C] border-[#D4A72C]/30 hover:bg-[#D4A72C]/25'
                      : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                </button>
              )}

              {onScanDuplicates && (
                <button
                  type="button"
                  onClick={() => {
                    setMergeSuccessMsg(null);
                    setShowDuplicatesModal(true);
                    void onScanDuplicates();
                  }}
                  title={
                    duplicateGroups.length > 0
                      ? `${duplicateGroups.length} grupo(s) de conversas duplicadas detectado(s) — clique para pré-visualizar`
                      : 'Verificar e unificar conversas duplicadas no Firestore'
                  }
                  className={`p-1 rounded border text-[10px] flex items-center gap-1 transition-colors cursor-pointer ${
                    duplicateGroups.length > 0
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 font-bold'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-[#D4A72C] hover:border-[#D4A72C]/40'
                  }`}
                >
                  <GitMerge size={12} />
                  {duplicateGroups.length > 0 && <span>{duplicateGroups.length}</span>}
                </button>
              )}

              {notifPermission === 'default' && (
                <button
                  type="button"
                  onClick={handleRequestDesktopNotification}
                  title="Ativar notificações do navegador para novas mensagens"
                  className="p-1 rounded border bg-slate-900 text-slate-300 border-slate-700 hover:text-[#D4A72C] hover:border-[#D4A72C]/40 transition-colors cursor-pointer"
                >
                  <BellRing size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          {/* Filter Tabs: Todas, Não lidas, IA, Humano, Encerradas */}
          <div className="grid grid-cols-5 gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`py-1 rounded text-center transition-colors cursor-pointer ${
                filterMode === 'all' ? 'bg-[#D4A72C] text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('unread')}
              className={`py-1 rounded text-center transition-colors cursor-pointer ${
                filterMode === 'unread' ? 'bg-[#D4A72C] text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              Não lidas{unreadTotalCount > 0 ? ` (${unreadTotalCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ai')}
              className={`py-1 rounded text-center transition-colors cursor-pointer ${
                filterMode === 'ai' ? 'bg-[#D4A72C] text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              IA
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('human')}
              className={`py-1 rounded text-center transition-colors cursor-pointer ${
                filterMode === 'human' ? 'bg-[#D4A72C] text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              Humano
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('resolved')}
              className={`py-1 rounded text-center transition-colors cursor-pointer ${
                filterMode === 'resolved' ? 'bg-[#D4A72C] text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              Encerr.
            </button>
          </div>
        </div>

        {/* Conversation Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 space-y-2">
              <MessageSquare size={24} className="mx-auto text-slate-600 mb-1" />
              <div className="font-medium text-slate-400">Nenhuma conversa encontrada</div>
              <p className="text-[11px] text-slate-500">
                Inicie um contato pelo CRM ou aguarde mensagens oficiais encaminhadas pelo webhook PHP.
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = activeConv?.id === conv.id;
              return (
                <div
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`group p-3 cursor-pointer transition-colors flex items-start gap-3 ${
                    isSelected ? 'bg-[#151926] ring-1 ring-inset ring-[#D4A72C]/50' : 'hover:bg-slate-900/60'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-200 shrink-0">
                    {conv.contactName.substring(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white truncate">{conv.contactName}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-400 tabular-nums">
                          {new Date(conv.lastMessageTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {onDeleteConversation && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConvToDelete(conv);
                            }}
                            title="Deletar conversa"
                            aria-label={`Deletar conversa com ${conv.contactName}`}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer opacity-70 group-hover:opacity-100"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {conv.lastMessage}
                    </p>

                    <div className="flex items-center justify-between mt-1.5 gap-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                            conv.status === 'resolved'
                              ? 'bg-slate-800 text-slate-400 border border-slate-700'
                              : conv.status === 'ai_active' && !conv.aiPaused
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {conv.status === 'resolved'
                            ? 'Encerrada'
                            : conv.status === 'ai_active' && !conv.aiPaused
                            ? 'IA Ativa'
                            : conv.assignedAgent || 'Humano'}
                        </span>
                        {conv.aiPaused && conv.status !== 'resolved' && (
                          <span className="text-[9px] text-amber-300 font-semibold">• IA Pausada</span>
                        )}
                      </div>

                      {conv.unreadCount > 0 && (
                        <span className="w-4 h-4 rounded-full bg-[#D4A72C] text-slate-950 font-black text-[9px] flex items-center justify-center tabular-nums shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT: Active Chat View */}
      {activeConv ? (
        <div className="flex-1 flex flex-col bg-[#090B10] min-w-0">
          {/* Chat Header */}
          <div className="p-3.5 border-b border-slate-800 bg-[#11141E] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4A72C] to-[#7A5B0B] p-[1.5px] shrink-0">
                <div className="w-full h-full rounded-full bg-[#151926] flex items-center justify-center text-xs font-bold text-white">
                  {activeConv.contactName.substring(0, 2).toUpperCase()}
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-white truncate">{activeConv.contactName}</h3>
                  <span className="text-xs text-slate-400 font-mono">+{activeConv.contactPhone}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-1 ${
                      isWindowOpen
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    <Clock size={10} />
                    <span>
                      {isWindowOpen ? `Janela 24h (${remainingHours24h}h)` : 'Fora 24h (Template)'}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  <span className={`font-medium ${isMetaConnected ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {isMetaConnected ? 'Meta Cloud Conectada' : 'Meta Cloud Pendente'}
                  </span>
                  <span>•</span>
                  <span>
                    Responsável: <strong className="text-slate-200">{activeConv.assignedAgent}</strong>
                  </span>
                  {activeConv.aiPaused && (
                    <>
                      <span>•</span>
                      <span className="text-amber-300 font-semibold">IA Pausada</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Operational Controls */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {onSendTemplate && (
                <button
                  type="button"
                  onClick={handleOpenTemplateModal}
                  className="px-2.5 py-1.5 rounded-lg bg-[#D4A72C]/15 hover:bg-[#D4A72C]/25 text-[#D4A72C] border border-[#D4A72C]/40 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Enviar Template aprovado pela Meta (obrigatório fora da janela de 24h)"
                >
                  <FileText size={13} />
                  <span>Template</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowSimulateModal(true)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
                title="Simular mensagem recebida localmente para validar o Atendente IA"
              >
                <Zap size={13} className="text-[#D4A72C]" />
                <span>Simular</span>
              </button>

              {activeConv.status !== 'resolved' && (
                <button
                  type="button"
                  onClick={() => handleHandoverAction({ aiPaused: !activeConv.aiPaused })}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    activeConv.aiPaused
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                  }`}
                  title={activeConv.aiPaused ? 'Reativar IA nesta conversa' : 'Pausar IA nesta conversa'}
                >
                  {activeConv.aiPaused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                  <span>{activeConv.aiPaused ? 'Reativar IA' : 'Pausar IA'}</span>
                </button>
              )}

              {attendants.length > 0 && (
                <select
                  value={activeConv.assignedUserId || ''}
                  onChange={(e) => {
                    const uid = e.target.value;
                    if (!uid) return;
                    const chosen = attendants.find((a) => a.id === uid);
                    if (chosen) {
                      void handleHandoverAction({
                        status: 'human_takeover',
                        assignedAgent: chosen.name,
                        assignedUserId: chosen.id,
                        aiPaused: true,
                        note: `Transferido para ${chosen.name}`
                      });
                    }
                  }}
                  className="bg-[#151926] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
                  title="Atribuir/transferir conversa para atendente humano"
                >
                  <option value="">Transferir atendente...</option>
                  {attendants.map((att) => (
                    <option key={att.id} value={att.id}>
                      {att.name} ({att.role})
                    </option>
                  ))}
                </select>
              )}

              {activeConv.status === 'ai_active' ? (
                <button
                  type="button"
                  onClick={() =>
                    handleHandoverAction({
                      status: 'human_takeover',
                      assignedAgent: 'Humano',
                      aiPaused: true
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <UserCheck size={13} />
                  <span>Assumir</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    handleHandoverAction({
                      status: 'ai_active',
                      assignedAgent: 'Atendente IA',
                      assignedUserId: '',
                      aiPaused: false
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Bot size={13} />
                  <span>Ativar IA</span>
                </button>
              )}

              {activeConv.status === 'resolved' ? (
                <button
                  type="button"
                  onClick={() =>
                    handleHandoverAction({
                      status: 'human_takeover',
                      assignedAgent: 'Humano',
                      aiPaused: true
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Reabrir</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    handleHandoverAction({
                      status: 'resolved',
                      assignedAgent: activeConv.assignedAgent || 'Humano',
                      aiPaused: true
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  title="Encerrar atendimento"
                >
                  <CheckCircle2 size={12} />
                  <span>Encerrar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowHistoryDrawer((prev) => !prev)}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  showHistoryDrawer
                    ? 'bg-[#D4A72C]/20 border-[#D4A72C]/40 text-[#D4A72C]'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Ver histórico de transferências"
              >
                <History size={14} />
              </button>

              {onDeleteConversation && (
                <button
                  type="button"
                  onClick={() => setConvToDelete(activeConv)}
                  title="Deletar conversa"
                  aria-label="Deletar conversa selecionada"
                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* CRM Lead & Client Linkage Bar */}
          <div className="px-4 py-2 bg-[#0d1017] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              {linkedLead ? (
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200">
                  Lead: <strong className="text-[#D4A72C]">{linkedLead.company}</strong> ({linkedLead.status})
                </span>
              ) : (
                <span className="text-slate-500">Sem lead vinculado</span>
              )}

              {linkedClient && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  Cliente: <strong>{linkedClient.tradeName || linkedClient.companyName}</strong>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {linkedClient && onOpenClientProfile && (
                <button
                  type="button"
                  onClick={() => onOpenClientProfile(linkedClient.id)}
                  className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Building2 size={12} />
                  <span>Abrir Cadastro Cliente</span>
                </button>
              )}

              {!linkedLead && onCreateLeadFromWhatsApp && (
                <button
                  type="button"
                  disabled={creatingLead}
                  onClick={handleCreateLeadClick}
                  className="px-2.5 py-1 rounded bg-[#D4A72C]/15 hover:bg-[#D4A72C]/25 text-[#D4A72C] border border-[#D4A72C]/30 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <UserPlus size={12} />
                  <span>{creatingLead ? 'Criando...' : 'Criar Lead'}</span>
                </button>
              )}

              {onLinkConversation && (
                <button
                  type="button"
                  onClick={handleOpenLinkModal}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Link2 size={12} />
                  <span>Vincular Lead/Cliente</span>
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Handover History Panel */}
          {showHistoryDrawer && (
            <div className="px-4 py-2.5 bg-[#0B0E16] border-b border-slate-800 max-h-36 overflow-y-auto space-y-1.5 text-[11px]">
              <div className="font-bold text-slate-300 flex items-center justify-between">
                <span>Histórico de Transferências & Ações ({(activeConv.handoverHistory || []).length})</span>
                <button
                  type="button"
                  onClick={() => setShowHistoryDrawer(false)}
                  className="text-slate-500 hover:text-white cursor-pointer"
                >
                  Fechar
                </button>
              </div>
              {(!activeConv.handoverHistory || activeConv.handoverHistory.length === 0) ? (
                <div className="text-slate-500 italic text-[10px]">Nenhuma transferência registrada nesta conversa.</div>
              ) : (
                [...activeConv.handoverHistory].reverse().map((item) => (
                  <div key={item.id} className="text-[10px] font-mono text-slate-300 flex flex-wrap items-center gap-2 border-b border-slate-900 pb-1 last:border-b-0">
                    <span className="text-slate-500">{formatDateTimeBR(item.at, { includeSeconds: true })}</span>
                    <span className="px-1.5 rounded bg-slate-800 text-[#D4A72C] uppercase">{item.action}</span>
                    <span>por <strong>{item.byUser}</strong></span>
                    <span className="text-slate-400">({item.fromStatus} → {item.toStatus} • {item.assignedTo})</span>
                    {item.note && <span className="text-slate-400 italic">— {item.note}</span>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(#151926_1px,transparent_1px)] [background-size:16px_16px]">
            {activeConv.messages.map((msg) => {
              const isContact = msg.sender === 'contact';
              const isFailed = msg.status === 'failed';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isContact ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[70%] p-3.5 rounded-2xl text-xs shadow-md ${
                      isFailed
                        ? 'bg-rose-950/60 text-rose-100 rounded-tr-sm border border-rose-500/50'
                        : isContact
                        ? 'bg-[#151926] text-slate-100 rounded-tl-sm border border-slate-800'
                        : msg.aiGenerated
                        ? 'bg-gradient-to-br from-[#1c2236] to-[#141b2c] text-white rounded-tr-sm border border-[#D4A72C]/40 shadow-[#D4A72C]/5'
                        : 'bg-emerald-950/80 text-emerald-50 rounded-tr-sm border border-emerald-700/50'
                    }`}
                  >
                    {/* Sender badge */}
                    <div className="flex items-center justify-between gap-3 mb-1 text-[10px]">
                      <span className={`font-bold ${isContact ? 'text-slate-400' : msg.aiGenerated ? 'text-[#D4A72C] flex items-center gap-1' : 'text-emerald-400'}`}>
                        {msg.aiGenerated && <Sparkles size={10} />}
                        {msg.senderName || (isContact ? activeConv.contactName : 'Consultor Humano')}
                      </span>
                      {msg.aiGenerated && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#D4A72C]/20 text-[#D4A72C] font-mono">
                          Gemini
                        </span>
                      )}
                    </div>

                    {/* Message Body */}
                    <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>

                    {isFailed && msg.errorMessage && (
                      <div className="mt-2 p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-[10px] text-rose-200 flex items-start gap-1.5">
                        <AlertCircle size={12} className="shrink-0 mt-0.5 text-rose-400" />
                        <span>{msg.errorMessage}</span>
                      </div>
                    )}

                    {/* Timestamp & Delivery status */}
                    <div className="flex items-center justify-end gap-1 mt-1.5 text-[9px] text-slate-400">
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {!isContact && (
                        isFailed ? (
                          <span className="text-rose-400 font-semibold">Falhou</span>
                        ) : msg.status === 'read' ? (
                          <span title="Lida pelo cliente" className="inline-flex">
                            <CheckCheck size={12} className="text-sky-400" />
                          </span>
                        ) : msg.status === 'delivered' ? (
                          <span title="Entregue no WhatsApp" className="inline-flex">
                            <CheckCheck size={12} className="text-slate-300" />
                          </span>
                        ) : (
                          <span title="Enviada para Meta API" className="inline-flex">
                            <Check size={12} className="text-slate-400" />
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Reply Shortcuts */}
          <div className="px-4 py-1.5 bg-[#0d1017] border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto text-[11px]">
            <span className="text-[10px] text-slate-400 uppercase font-semibold shrink-0">Respostas Rápidas:</span>
            <button
              type="button"
              onClick={() => setInputText('Olá! Vou consultar nosso catálogo oficial e te passar os valores e prazos certinhos para o seu projeto.')}
              className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 text-[10px] cursor-pointer"
            >
              Atendimento Inicial
            </button>
            <button
              type="button"
              onClick={() => setInputText('Podemos agendar uma demonstração de 15 minutos pelo Google Meet para te mostrar modelos do seu segmento?')}
              className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 text-[10px] cursor-pointer"
            >
              Convite Demonstração
            </button>
            <button
              type="button"
              onClick={() => setInputText('Estou gerando sua proposta formal no sistema com todas as condições e envio em seguida!')}
              className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 text-[10px] cursor-pointer"
            >
              Aviso de Proposta
            </button>
          </div>

          {/* Input Bar */}
          <form onSubmit={handleSend} className="p-3 bg-[#11141E] border-t border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder={
                isWindowOpen
                  ? 'Digite sua mensagem oficial para o cliente...'
                  : 'Janela de 24h fechada — envie um Template ou digite se o cliente respondeu recentemente...'
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 bg-[#151926] border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || sendingMsg}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
            >
              {sendingMsg ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              <span>{sendingMsg ? 'Enviando...' : 'Enviar'}</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#090B10]">
          <div className="w-14 h-14 rounded-2xl bg-[#11141E] border border-slate-800 flex items-center justify-center text-[#D4A72C] mb-3">
            <MessageSquare size={24} />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Nenhuma conversa selecionada</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Selecione uma conversa ao lado ou inicie um atendimento comercial clicando no botão de WhatsApp de qualquer Lead cadastrado no CRM.
          </p>
        </div>
      )}

      {/* MODAL: Link Lead / Client */}
      {showLinkModal && activeConv && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
                  <Link2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Vincular Conversa ao CRM</h3>
                  <p className="text-[10px] text-slate-400">+{activeConv.contactPhone} • {activeConv.contactName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLink} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Lead no CRM</label>
                <select
                  value={linkLeadId}
                  onChange={(e) => setLinkLeadId(e.target.value)}
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="">Nenhum lead vinculado</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.company} — {l.name} ({l.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Cliente Cadastrado</label>
                <select
                  value={linkClientId}
                  onChange={(e) => setLinkClientId(e.target.value)}
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="">Nenhum cliente vinculado</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.tradeName || c.companyName} — {c.contactName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingLink}
                  className="px-4 py-1.5 rounded-lg bg-[#D4A72C] text-slate-950 font-bold hover:brightness-110 cursor-pointer disabled:opacity-50"
                >
                  {savingLink ? 'Salvando...' : 'Salvar Vínculo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Simulate Customer Message */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
                  <Zap size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Simulador de WhatsApp Recebido</h3>
                  <p className="text-[10px] text-slate-400">Envie uma mensagem fingindo ser o cliente para ver o Atendente IA responder</p>
                </div>
              </div>
              <button 
                onClick={() => setShowSimulateModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateSend} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mensagem simulada do cliente ({activeConv?.contactName}):
                </label>
                <textarea
                  rows={3}
                  value={simulatedText}
                  onChange={(e) => setSimulatedText(e.target.value)}
                  placeholder="Ex: 'Olá, quanto custa para criar uma loja virtual para venda de roupas?' ou 'Gostaria de falar com um atendente humano'."
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
                  required
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400">Sugestões rápidas:</span>
                <button
                  type="button"
                  onClick={() => setSimulatedText('Quanto custa para criar um site institucional com agendamento no WhatsApp?')}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white"
                >
                  Pedir orçamento site
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatedText('Quero falar agora com um consultor humano, por favor.')}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white"
                >
                  Pedir humano
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSimulateModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#D4A72C] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1"
                >
                  <Play size={12} fill="currentColor" />
                  <span>Disparar Mensagem</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Delete Conversation */}
      {convToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Deletar conversa do WhatsApp?</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tem certeza que deseja excluir permanentemente o histórico com{' '}
                  <strong className="text-white">{convToDelete.contactName}</strong>{' '}
                  <span className="font-mono text-slate-300">(+{convToDelete.contactPhone})</span>?
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {convToDelete.messages.length} mensage{convToDelete.messages.length === 1 ? 'm' : 'ns'} será(ão) removida(s) do CRM e sincronizada(s) com o banco de dados.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={deletingConv}
                onClick={() => setConvToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingConv}
                onClick={handleConfirmDeleteConversation}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 size={13} />
                <span>{deletingConv ? 'Deletando...' : 'Deletar Conversa'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Send Meta Template */}
      {showTemplateModal && activeConv && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
                  <FileText size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Enviar Template Oficial (Meta API)</h3>
                  <p className="text-[10px] text-slate-400">
                    Para iniciar conversa com +{activeConv.contactPhone} ou quando a janela de 24h estiver fechada
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {templatesError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {templatesError}
              </div>
            )}

            <form onSubmit={handleSendTemplateSubmit} className="space-y-3 text-xs">
              {templatesLoading ? (
                <div className="p-4 text-center text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-[#D4A72C]" />
                  <span>Carregando templates do WABA na Meta...</span>
                </div>
              ) : metaTemplates.length > 0 ? (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Template Aprovado na Meta</label>
                  <select
                    value={selectedTemplateName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setSelectedTemplateName(name);
                      const found = metaTemplates.find((t) => t.name === name);
                      if (found?.language) setSelectedTemplateLang(found.language);
                    }}
                    className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                  >
                    {metaTemplates.map((t) => (
                      <option key={`${t.name}_${t.language}`} value={t.name}>
                        {t.name} ({t.language}) — {t.status}
                      </option>
                    ))}
                  </select>
                  {metaTemplates.find((t) => t.name === selectedTemplateName)?.bodyText && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#090B10] border border-slate-800 text-[11px] text-slate-300 whitespace-pre-line">
                      {metaTemplates.find((t) => t.name === selectedTemplateName)?.bodyText}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Nome do Template</label>
                    <input
                      type="text"
                      value={selectedTemplateName}
                      onChange={(e) => setSelectedTemplateName(e.target.value)}
                      placeholder="hello_world"
                      className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Idioma</label>
                    <input
                      type="text"
                      value={selectedTemplateLang}
                      onChange={(e) => setSelectedTemplateLang(e.target.value)}
                      placeholder="en_US ou pt_BR"
                      className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Variáveis do corpo (opcional, separadas por <code className="text-[#D4A72C]">|</code>)
                </label>
                <input
                  type="text"
                  value={templateBodyParams}
                  onChange={(e) => setTemplateBodyParams(e.target.value)}
                  placeholder="Ex: Nicolas | Fazer Meu Website"
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sendingTemplate}
                  className="px-4 py-1.5 rounded-lg bg-[#D4A72C] text-slate-950 font-bold flex items-center gap-1.5 hover:brightness-110 cursor-pointer disabled:opacity-50"
                >
                  <Send size={13} />
                  <span>{sendingTemplate ? 'Enviando...' : 'Disparar Template'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL: Duplicate Conversation Diagnostics & Preview-Before-Approval Merge */}
      {showDuplicatesModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between gap-3 bg-[#11141E]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#D4A72C]/15 border border-[#D4A72C]/30 text-[#D4A72C] flex items-center justify-center shrink-0">
                  <GitMerge size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white">Diagnóstico e Unificação de Conversas Duplicadas</h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    {firebaseWorkspaceId
                      ? `Workspace Firestore: workspaces/${firebaseWorkspaceId}/whatsappConversations`
                      : 'Conecte sua conta Google no Firebase para inspecionar o Firestore'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {onScanDuplicates && (
                  <button
                    type="button"
                    disabled={scanningDuplicates}
                    onClick={() => {
                      setMergeSuccessMsg(null);
                      void onScanDuplicates();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={scanningDuplicates ? 'animate-spin text-[#D4A72C]' : ''} />
                    <span>{scanningDuplicates ? 'Verificando...' : 'Reescanear'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDuplicatesModal(false)}
                  className="text-slate-400 hover:text-white text-xs px-2 py-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {mergeSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span>{mergeSuccessMsg}</span>
                </div>
              )}

              {!firebaseWorkspaceId ? (
                <div className="p-6 text-center bg-[#090B10] border border-slate-800 rounded-xl text-xs text-slate-400">
                  Faça login com sua conta Google verificada do Workspace no CRM para executar a varredura segura no Firestore.
                </div>
              ) : scanningDuplicates && duplicateGroups.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                  <RefreshCw size={20} className="animate-spin text-[#D4A72C]" />
                  <span>Inspecionando conversas e subcoleções no Firestore (somente leitura)...</span>
                </div>
              ) : duplicateGroups.length === 0 ? (
                <div className="p-6 text-center bg-[#090B10] border border-emerald-500/20 rounded-xl space-y-2">
                  <ShieldCheck size={24} className="mx-auto text-emerald-400" />
                  <h4 className="text-sm font-bold text-white">Nenhuma conversa duplicada encontrada</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Todas as conversas em <code className="text-[#D4A72C]">whatsappConversations</code> estão unificadas pela chave determinística{' '}
                    <code className="text-slate-300">workspaceId + phoneNumberId + wa_id</code>.
                  </p>
                </div>
              ) : (
                duplicateGroups.map((group) => {
                  const isMerging = mergingDuplicateKey === group.groupKey;
                  return (
                    <div
                      key={group.groupKey}
                      className="bg-[#090B10] border border-[#D4A72C]/30 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-white">{group.contactName}</span>
                            <span className="text-xs font-mono text-[#D4A72C]">+{group.normalizedPhone}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                              {group.conversations.length} conversas duplicadas
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 break-all">
                            Chave determinística: <span className="text-slate-200">{group.conversationKey}</span>
                          </div>
                          <div className="text-[10px] font-mono text-emerald-300 break-all">
                            Destino unificado: {group.targetFirestorePath}
                          </div>
                        </div>

                        {onMergeDuplicateGroup && (
                          <button
                            type="button"
                            disabled={Boolean(mergingDuplicateKey)}
                            onClick={async () => {
                              setMergeSuccessMsg(null);
                              await onMergeDuplicateGroup(group);
                              setMergeSuccessMsg(
                                `Conversa com +${group.normalizedPhone} unificada em ${group.targetConversationId} (${group.mergedMessagesCount} mensagens preservadas).`
                              );
                            }}
                            className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs flex items-center gap-1.5 hover:brightness-110 cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {isMerging ? (
                              <RefreshCw size={13} className="animate-spin" />
                            ) : (
                              <GitMerge size={13} />
                            )}
                            <span>{isMerging ? 'Unificando...' : 'Aprovar e Unificar'}</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {group.conversations.map((thread) => (
                          <div
                            key={thread.id}
                            className="p-3 rounded-lg bg-[#11141E] border border-slate-800 space-y-1.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-white truncate">{thread.id}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-[#D4A72C] border border-slate-700 shrink-0">
                                {thread.originHint}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 break-all">
                              {thread.firestorePath}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-300 pt-0.5">
                              <span>Tel: <strong className="font-mono">+{thread.contactPhone}</strong></span>
                              <span>•</span>
                              <span>Msgs: <strong>{thread.totalMessages}</strong> ({thread.inboundCount} receb., {thread.outboundCount} env., {thread.aiCount} IA)</span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              Última: <span className="text-slate-200">{thread.lastMessage || '(sem texto)'}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Status: {thread.status} {thread.aiPaused ? '• IA Pausada' : '• IA Ativa'} • {formatDateTimeBR(thread.lastMessageTimestamp, { includeSeconds: true })}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="p-3 rounded-lg bg-[#11141E] border border-slate-800/80 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-slate-200">
                            Prévia do Histórico Unificado ({group.mergedMessagesCount} mensagens preservadas
                            {group.deduplicatedCount > 0
                              ? `, ${group.deduplicatedCount} cópia(s) repetida(s) removida(s)`
                              : ''}
                            )
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Ordem cronológica preservada (IDs Meta wamid mantidos)
                          </span>
                        </div>
                        {group.sampleTimeline.length === 0 ? (
                          <div className="text-[10px] text-slate-500 italic">
                            Nenhuma mensagem registrada nas subcoleções deste grupo.
                          </div>
                        ) : (
                          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                            {group.sampleTimeline.map((m) => (
                              <div
                                key={`${m.id}_${m.timestamp}`}
                                className="text-[10px] flex items-start justify-between gap-2 bg-[#090B10] px-2.5 py-1.5 rounded border border-slate-800/70"
                              >
                                <div className="min-w-0">
                                  <span
                                    className={`font-bold mr-1.5 ${
                                      m.sender === 'contact'
                                        ? 'text-sky-300'
                                        : m.aiGenerated
                                        ? 'text-[#D4A72C]'
                                        : 'text-emerald-300'
                                    }`}
                                  >
                                    {m.sender === 'contact'
                                      ? 'Cliente (inbound)'
                                      : m.aiGenerated
                                      ? 'Atendente IA (outbound)'
                                      : 'Operador (outbound)'}
                                    :
                                  </span>
                                  <span className="text-slate-200 break-words">{m.text}</span>
                                </div>
                                <span className="text-slate-500 font-mono shrink-0">
                                  {formatDateTimeBR(m.timestamp)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-[#11141E] flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>Nenhuma conversa ou mensagem é alterada até você clicar em &quot;Aprovar e Unificar&quot;.</span>
              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
