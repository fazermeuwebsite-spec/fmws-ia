import React, { useState } from 'react';
import {
  Bell,
  Plus,
  ChevronDown,
  Sparkles,
  Cpu,
  LogOut,
  KeyRound,
  ShieldCheck,
  Database,
  X
} from 'lucide-react';
import { User, SystemIntegrations } from '../types';
import { api } from '../services/api';
import { firestoreProjectId, firestoreDatabaseId, type FirebaseUser } from '../firebase';

interface NavbarProps {
  currentUser: User;
  permissions: string[];
  onLogout: () => void;
  onOpenQuickAction: (action: 'lead' | 'proposal' | 'ticket' | 'prospect') => void;
  title: string;
  subtitle?: string;
  integrations?: SystemIntegrations;
  unreadWhatsApp?: number;
  pendingOutreach?: number;
  pendingProposals?: number;
  openTickets?: number;
  firebaseUser?: FirebaseUser | null;
  firestoreOnline?: boolean;
  cloudSyncStatus?: 'disconnected' | 'syncing' | 'synced' | 'error';
  onConnectFirebase?: () => Promise<void>;
  onSyncFirestore?: () => Promise<void>;
  onPasswordChanged?: () => Promise<void>;
  onNavigate?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  permissions,
  onLogout,
  onOpenQuickAction,
  title,
  subtitle,
  integrations,
  unreadWhatsApp = 0,
  pendingOutreach = 0,
  pendingProposals = 0,
  openTickets = 0,
  firebaseUser,
  firestoreOnline = true,
  cloudSyncStatus = 'disconnected',
  onConnectFirebase,
  onSyncFirestore,
  onPasswordChanged,
  onNavigate
}) => {
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdMessage, setPwdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  const isMetaConnected = integrations?.metaCloud?.status === 'conectado';
  const geminiStatus = integrations?.gemini?.status;
  const isGeminiConnected = geminiStatus === 'conectado';
  const deepseekStatus = integrations?.deepseek?.status;
  const isDeepSeekConnected = deepseekStatus === 'conectado';
  const isAsaasConnected = integrations?.asaas?.status === 'conectado';
  const isPlacesConnected = integrations?.googlePlaces?.status === 'conectado';

  const formatProviderBadgeText = (status?: string) => {
    if (status === 'conectado') return 'Conectado';
    if (status === 'desconectado') return 'Desativado';
    if (status === 'sem_saldo') return 'Sem saldo';
    if (status === 'limite_atingido') return 'Limite';
    if (status === 'erro') return 'Erro';
    return 'Não configurado';
  };

  const hasPerm = (perm: string) =>
    currentUser.role === 'admin' || permissions.includes('*') || permissions.includes(perm);

  const totalNotifications =
    (pendingOutreach > 0 ? 1 : 0) +
    (unreadWhatsApp > 0 ? 1 : 0) +
    (pendingProposals > 0 ? 1 : 0) +
    (openTickets > 0 ? 1 : 0);

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    setPwdSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await onPasswordChanged?.();
      setPwdMessage({ type: 'success', text: 'Senha alterada e salva com sucesso!' });
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => {
        setPwdModalOpen(false);
        setPwdMessage(null);
      }, 1500);
    } catch (err: any) {
      setPwdMessage({ type: 'error', text: err.message || 'Erro ao alterar senha.' });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <>
      <header className="h-16 bg-[#090B10]/95 backdrop-blur border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 gap-3">
        {/* Title & Subtitle */}
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] sm:text-xs text-slate-400 font-normal truncate">{subtitle}</p>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Status badges with real states */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 bg-slate-900/80 border border-slate-800 rounded-lg text-[11px]">
            <span className={`flex items-center gap-1.5 font-medium ${isMetaConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isMetaConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              WhatsApp: {isMetaConnected ? 'Conectado' : 'Não configurado'}
            </span>
            <span className="text-slate-700">|</span>
            <span className={`flex items-center gap-1.5 font-medium ${isGeminiConnected ? 'text-[#D4A72C]' : 'text-slate-400'}`}>
              <Sparkles size={11} /> Gemini: {formatProviderBadgeText(geminiStatus)}
            </span>
            <span className="text-slate-700">|</span>
            <span
              className={`flex items-center gap-1.5 font-medium ${
                isDeepSeekConnected
                  ? 'text-emerald-400'
                  : deepseekStatus === 'sem_saldo'
                  ? 'text-amber-300'
                  : deepseekStatus === 'erro'
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              <Cpu size={11} /> DeepSeek: {formatProviderBadgeText(deepseekStatus)}
            </span>
            <span className="text-slate-700">|</span>
            <span className={`flex items-center gap-1.5 font-medium ${isPlacesConnected ? 'text-amber-300' : 'text-slate-400'}`}>
              Places: {isPlacesConnected ? 'Conectado' : 'Não configurado'}
            </span>
            <span className="text-slate-700">|</span>
            <span className={`flex items-center gap-1.5 font-medium ${isAsaasConnected ? 'text-blue-400' : 'text-slate-400'}`}>
              Asaas: {isAsaasConnected ? 'Conectado' : 'Não configurado'}
            </span>
          </div>

          {/* Firebase Firestore Connected / Sync Pill */}
          {firebaseUser?.emailVerified ? (
            <button
              type="button"
              onClick={() => onSyncFirestore?.()}
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-[11px] font-semibold hover:bg-slate-800 cursor-pointer border ${
                cloudSyncStatus === 'error'
                  ? 'border-rose-500/40 text-rose-300'
                  : 'border-emerald-500/35 text-emerald-300'
              }`}
              title={`Sincronização Firestore ativa (${firestoreProjectId} / ${firestoreDatabaseId}) com ${firebaseUser.email}. Clique para sincronizar agora.`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  cloudSyncStatus === 'error'
                    ? 'bg-rose-400'
                    : cloudSyncStatus === 'syncing'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-emerald-400'
                }`}
              />
              <Database size={12} className="text-[#D4A72C]" />
              <span>
                {cloudSyncStatus === 'syncing'
                  ? 'Salvando Nuvem...'
                  : cloudSyncStatus === 'error'
                  ? 'Erro Sync (Tentar)'
                  : 'Nuvem Sincronizada'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onConnectFirebase?.()}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-[11px] font-semibold text-amber-300 cursor-pointer"
              title={`Sessão local (${firestoreProjectId} • ${firestoreDatabaseId}). ${
                firestoreOnline ? 'Conecte sua conta Google para restaurar e sincronizar dados na nuvem.' : 'Firestore offline.'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${firestoreOnline ? 'bg-amber-400' : 'bg-rose-400'}`} />
              <Database size={12} className="text-[#D4A72C]" />
              <span>{firestoreOnline ? 'Ativar Sync Nuvem' : 'Firestore Offline'}</span>
            </button>
          )}

          {/* Quick Action Button */}
          {(hasPerm('leads.write') || hasPerm('proposals.write') || hasPerm('support.write') || hasPerm('prospecting.read')) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowActionDropdown(!showActionDropdown)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer"
              >
                <Plus size={14} strokeWidth={2.5} />
                <span className="hidden sm:inline">Criar Novo</span>
                <ChevronDown size={12} />
              </button>

              {showActionDropdown && (
                <div
                  className="absolute right-0 mt-2 w-52 bg-[#151926] border border-slate-700 rounded-xl shadow-2xl py-1 z-50 overflow-hidden"
                  onMouseLeave={() => setShowActionDropdown(false)}
                >
                  {hasPerm('leads.write') && (
                    <button
                      type="button"
                      onClick={() => { setShowActionDropdown(false); onOpenQuickAction('lead'); }}
                      className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800/80 hover:text-[#D4A72C] flex items-center justify-between cursor-pointer"
                    >
                      <span>+ Novo Lead / Contato</span>
                      <span className="text-[10px] text-slate-400 font-mono">CRM</span>
                    </button>
                  )}
                  {hasPerm('proposals.write') && (
                    <button
                      type="button"
                      onClick={() => { setShowActionDropdown(false); onOpenQuickAction('proposal'); }}
                      className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800/80 hover:text-[#D4A72C] flex items-center justify-between cursor-pointer"
                    >
                      <span>+ Proposta Comercial</span>
                      <span className="text-[10px] text-slate-400 font-mono">Vendas</span>
                    </button>
                  )}
                  {hasPerm('support.write') && (
                    <button
                      type="button"
                      onClick={() => { setShowActionDropdown(false); onOpenQuickAction('ticket'); }}
                      className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800/80 hover:text-[#D4A72C] flex items-center justify-between cursor-pointer"
                    >
                      <span>+ Chamado de Suporte</span>
                      <span className="text-[10px] text-slate-400 font-mono">SLA</span>
                    </button>
                  )}
                  {hasPerm('prospecting.read') && (
                    <button
                      type="button"
                      onClick={() => { setShowActionDropdown(false); onOpenQuickAction('prospect'); }}
                      className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800/80 hover:text-[#D4A72C] flex items-center justify-between cursor-pointer"
                    >
                      <span>+ Prospecção & Auditoria</span>
                      <span className="text-[10px] text-slate-400 font-mono">Radar</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notifications Icon */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors relative cursor-pointer"
            >
              <Bell size={15} />
              {totalNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#D4A72C] animate-pulse" />
              )}
            </button>

            {showNotifications && (
              <div
                className="absolute right-0 mt-2 w-80 bg-[#151926] border border-slate-700 rounded-xl shadow-2xl p-3 z-50"
                onMouseLeave={() => setShowNotifications(false)}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-white">Notificações do Sistema</span>
                  <span className="text-[10px] text-[#D4A72C] font-semibold">
                    {totalNotifications > 0 ? `${totalNotifications} Alertas` : '0 Alertas'}
                  </span>
                </div>
                <div className="space-y-2 mt-2">
                  {totalNotifications === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 italic">
                      Nenhuma notificação pendente no momento.
                    </div>
                  ) : (
                    <>
                      {pendingOutreach > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotifications(false);
                            onNavigate?.('ai_agents');
                          }}
                          className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-[11px] transition-colors cursor-pointer"
                        >
                          <div className="text-[#D4A72C] font-semibold">Prospecção • Aprovação Humana</div>
                          <div className="text-slate-300">
                            {pendingOutreach} lead(s) aguardando aprovação para primeiro contato comercial.
                          </div>
                        </button>
                      )}
                      {unreadWhatsApp > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotifications(false);
                            onNavigate?.('whatsapp');
                          }}
                          className="w-full text-left p-2 rounded-lg bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-500/30 text-[11px] transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between text-emerald-400 font-semibold">
                            <span>WhatsApp Oficial</span>
                            <span className="text-[10px] underline">Abrir Chat</span>
                          </div>
                          <div className="text-slate-200">{unreadWhatsApp} mensagem(ns) não lida(s).</div>
                        </button>
                      )}
                      {pendingProposals > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotifications(false);
                            onNavigate?.('proposals');
                          }}
                          className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-[11px] transition-colors cursor-pointer"
                        >
                          <div className="text-yellow-400 font-semibold">Propostas Comerciais</div>
                          <div className="text-slate-300">{pendingProposals} proposta(s) aguardando aprovação.</div>
                        </button>
                      )}
                      {openTickets > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowNotifications(false);
                            onNavigate?.('support');
                          }}
                          className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-[11px] transition-colors cursor-pointer"
                        >
                          <div className="text-rose-400 font-semibold">Suporte & SLA</div>
                          <div className="text-slate-300">{openTickets} chamado(s) em aberto.</div>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Authenticated User Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="w-6 h-6 rounded-full object-cover border border-[#D4A72C]/40"
              />
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-200 leading-tight">
                  {currentUser.name.split(' ')[0]}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-[#D4A72C] font-bold">
                  {currentUser.role}
                </span>
              </div>
              <ChevronDown size={12} className="text-slate-400 ml-1" />
            </button>

            {showUserDropdown && (
              <div
                className="absolute right-0 mt-2 w-60 bg-[#151926] border border-slate-700 rounded-xl shadow-2xl py-2 z-50"
                onMouseLeave={() => setShowUserDropdown(false)}
              >
                <div className="px-3.5 pb-2.5 mb-1 border-b border-slate-800">
                  <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{currentUser.email}</div>
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#D4A72C]/15 text-[#D4A72C] font-bold uppercase">
                    <ShieldCheck size={11} /> Função: {currentUser.role}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowUserDropdown(false);
                    setPwdModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-800/80 hover:text-[#D4A72C] cursor-pointer"
                >
                  <KeyRound size={13} />
                  <span>Alterar Minha Senha</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowUserDropdown(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2 px-3.5 py-2 text-xs text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                >
                  <LogOut size={13} />
                  <span>Encerrar Sessão (Sair)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Change Password Modal */}
      {pwdModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound size={15} className="text-[#D4A72C]" />
                <span>Alterar Minha Senha</span>
              </h3>
              <button
                type="button"
                onClick={() => setPwdModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleChangePasswordSubmit} className="p-4 space-y-3 text-xs">
              {pwdMessage && (
                <div
                  className={`p-2.5 rounded-lg border ${
                    pwdMessage.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {pwdMessage.text}
                </div>
              )}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Senha Atual</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nova Senha (mín. 6 caracteres)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwdModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="px-4 py-2 rounded-lg bg-[#D4A72C] text-slate-950 font-bold cursor-pointer disabled:opacity-50"
                >
                  {pwdSaving ? 'Salvando...' : 'Atualizar Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
