import React, { useState, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Settings,
  CheckCircle2,
  Send,
  Zap,
  AlertTriangle,
  Power,
  Activity,
  Plus,
  X,
  Database,
  RefreshCw,
  Globe,
  Play,
  Lock
} from 'lucide-react';
import { AIAgentConfig, Lead, SystemIntegrations } from '../types';
import { api } from '../services/api';
import type { FirebaseUser } from '../firebase';

interface AIAgentsModuleProps {
  agents: AIAgentConfig[];
  integrations?: SystemIntegrations;
  pendingLeads: Lead[];
  onUpdateAgent: (agentId: string, updatedData: Partial<AIAgentConfig>) => Promise<void>;
  onRefreshAgentsAndIntegrations: (agent?: AIAgentConfig, integrations?: SystemIntegrations) => void;
  onApproveColdOutreach: (leadId: string, pitchText: string) => void;
  firebaseUser?: FirebaseUser | null;
  firestoreOnline?: boolean;
  cloudSyncStatus?: 'disconnected' | 'syncing' | 'synced' | 'error';
  onConnectFirebase?: () => Promise<void>;
  onSyncFirestore?: () => Promise<void>;
}

export const AIAgentsModule: React.FC<AIAgentsModuleProps> = ({
  agents,
  integrations,
  pendingLeads,
  onUpdateAgent,
  onRefreshAgentsAndIntegrations,
  onApproveColdOutreach,
  firebaseUser,
  firestoreOnline = true,
  cloudSyncStatus = 'disconnected',
  onConnectFirebase,
  onSyncFirestore
}) => {
  const safeAgents = Array.isArray(agents) ? agents : [];
  const safePendingLeads = Array.isArray(pendingLeads) ? pendingLeads : [];

  const [selectedAgentId, setSelectedAgentId] = useState<'atendente' | 'prospector'>('atendente');
  const [editingInstructions, setEditingInstructions] = useState<string>('');
  const [editingPersonality, setEditingPersonality] = useState<string>('');
  const [editingRules, setEditingRules] = useState<string[]>([]);
  const [newRuleText, setNewRuleText] = useState<string>('');
  const [editingThreshold, setEditingThreshold] = useState<number>(85);
  const [editingRequireApproval, setEditingRequireApproval] = useState<boolean>(true);

  const [savingConfig, setSavingConfig] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [agentFeedback, setAgentFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Interactive Lab state: Atendente IA
  const [simContactName, setSimContactName] = useState('João (Empresa Teste)');
  const [simMessage, setSimMessage] = useState('');
  const [simRunning, setSimRunning] = useState(false);
  const [simMessages, setSimMessages] = useState<
    Array<{ sender: 'contact' | 'agent'; text: string; handover?: boolean; suggestedStatus?: string }>
  >([]);

  // Interactive Lab state: Prospector IA
  const [auditCompany, setAuditCompany] = useState('Clínica Modelo Saúde');
  const [auditSegment, setAuditSegment] = useState('Saúde & Odontologia');
  const [auditCity, setAuditCity] = useState('São Paulo');
  const [auditState, setAuditState] = useState('SP');
  const [auditWebsite, setAuditWebsite] = useState('');
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    audit: any;
    pitchDraft?: string;
    aiInsights?: string;
    geminiUsed: boolean;
    warning?: string;
  } | null>(null);

  const activeAgent = safeAgents.find((a) => a.id === selectedAgentId) || safeAgents[0];

  useEffect(() => {
    if (activeAgent) {
      setEditingInstructions(activeAgent.instructions || '');
      setEditingPersonality(activeAgent.personality || '');
      setEditingRules(Array.isArray(activeAgent.rules) ? activeAgent.rules : []);
      setEditingThreshold(
        typeof activeAgent.autoReplyThreshold === 'number' ? activeAgent.autoReplyThreshold : 85
      );
      setEditingRequireApproval(Boolean(activeAgent.requiresApprovalForOutreach));
    } else {
      setEditingInstructions('');
      setEditingPersonality('');
      setEditingRules([]);
      setEditingThreshold(85);
      setEditingRequireApproval(true);
    }
  }, [activeAgent]);

  const handleSaveConfig = async () => {
    if (!activeAgent) return;
    setSavingConfig(true);
    setAgentFeedback(null);
    try {
      await onUpdateAgent(activeAgent.id, {
        instructions: editingInstructions,
        personality: editingPersonality,
        rules: editingRules,
        autoReplyThreshold: editingThreshold,
        requiresApprovalForOutreach: editingRequireApproval
      });
      setAgentFeedback({
        type: 'success',
        text: firebaseUser?.emailVerified
          ? `Configurações de ${activeAgent.name} salvas no servidor e sincronizadas com o Firebase Firestore.`
          : `Configurações de ${activeAgent.name} salvas no servidor! Conecte sua conta Google acima para replicar também no Firebase Firestore.`
      });
    } catch (err: any) {
      setAgentFeedback({
        type: 'error',
        text: err?.message || 'Erro ao salvar configurações do agente.'
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestConnection = async (agentId: 'atendente' | 'prospector') => {
    setTestingAgentId(agentId);
    setAgentFeedback(null);
    try {
      const res = await api.testAIAgent(agentId);
      onRefreshAgentsAndIntegrations(res.agent, res.integrations);
      setAgentFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok
          ? res.message || 'Conexão validada com sucesso!'
          : res.error || 'Falha ao validar conexão com o Gemini.'
      });
    } catch (err: any) {
      setAgentFeedback({
        type: 'error',
        text: err?.message || 'Erro ao testar agente.'
      });
    } finally {
      setTestingAgentId(null);
    }
  };

  const handleToggleAgentStatus = async (agent: AIAgentConfig) => {
    const nextStatus = agent.status === 'ativo' ? 'pausado' : 'ativo';
    setTogglingStatus(agent.id);
    setAgentFeedback(null);
    try {
      await onUpdateAgent(agent.id, { status: nextStatus });
      setAgentFeedback({
        type: 'success',
        text: `${agent.name} alterado para "${nextStatus === 'ativo' ? 'Ativo' : 'Pausado'}".`
      });
    } catch (err: any) {
      setAgentFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível alterar o status do agente.'
      });
    } finally {
      setTogglingStatus(null);
    }
  };

  const handleAddRule = () => {
    const trimmed = newRuleText.trim();
    if (!trimmed) return;
    setEditingRules((prev) => [...prev, trimmed]);
    setNewRuleText('');
  };

  const handleRemoveRule = (index: number) => {
    setEditingRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRunAtendenteSim = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = simMessage.trim();
    if (!text) return;

    const updatedHistory = [...simMessages, { sender: 'contact' as const, text }];
    setSimMessages(updatedHistory);
    setSimMessage('');
    setSimRunning(true);
    setAgentFeedback(null);

    try {
      const res = await api.simulateAtendenteAI({
        contactName: simContactName.trim() || 'Cliente Teste',
        message: text,
        chatHistory: updatedHistory.map((m) => ({ sender: m.sender, text: m.text }))
      });
      if (res.agent || res.integrations) {
        onRefreshAgentsAndIntegrations(res.agent, res.integrations);
      }

      if (res.error && !res.replyText) {
        setAgentFeedback({ type: 'error', text: res.error });
      } else {
        setSimMessages((prev) => [
          ...prev,
          {
            sender: 'agent',
            text: res.replyText || 'Sem resposta retornada pelo modelo.',
            handover: res.shouldHandover,
            suggestedStatus: res.suggestedLeadStatus
          }
        ]);
      }
    } catch (err: any) {
      setAgentFeedback({
        type: 'error',
        text: err?.message || 'Erro ao executar simulação do Atendente IA.'
      });
    } finally {
      setSimRunning(false);
    }
  };

  const handleRunProspectorTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auditCompany.trim()) return;
    setAuditRunning(true);
    setAgentFeedback(null);

    try {
      const res = await api.testProspectorAudit({
        companyName: auditCompany.trim(),
        segment: auditSegment.trim(),
        city: auditCity.trim(),
        state: auditState.trim(),
        websiteUrl: auditWebsite.trim() || undefined
      });
      setAuditResult(res);
      if (res.agent || res.integrations) {
        onRefreshAgentsAndIntegrations(res.agent, res.integrations);
      }
      if (res.warning) {
        setAgentFeedback({ type: 'error', text: res.warning });
      }
    } catch (err: any) {
      setAgentFeedback({
        type: 'error',
        text: err?.message || 'Erro ao executar diagnóstico do Prospector IA.'
      });
    } finally {
      setAuditRunning(false);
    }
  };

  const getStatusMeta = (status?: string) => {
    switch (status) {
      case 'online':
      case 'ativo':
      case 'conectado':
        return {
          label: status === 'online' ? 'Online' : status === 'ativo' ? 'Ativo' : 'Conectado',
          badge: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
          isActive: true
        };
      case 'em_treinamento':
      case 'em_execucao':
        return {
          label: status === 'em_treinamento' ? 'Em treinamento' : 'Em execução',
          badge: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
          isActive: true
        };
      case 'pausado':
        return {
          label: 'Pausado',
          badge: 'bg-slate-800 text-slate-300 border border-slate-700',
          isActive: false
        };
      case 'erro':
        return {
          label: 'Erro na API',
          badge: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
          isActive: false
        };
      default:
        return {
          label: 'Não configurado',
          badge: 'bg-slate-800 text-slate-300 border border-slate-700',
          isActive: false
        };
    }
  };

  const geminiConnected = integrations?.gemini?.status === 'conectado';
  const metaConnected = integrations?.metaCloud?.status === 'conectado';
  const placesConnected = integrations?.googlePlaces?.status === 'conectado';

  return (
    <div className="space-y-6">
      {/* Top Governance / Guardrail + Integration Health Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-[#151926] via-[#11141E] to-[#151926] border border-[#D4A72C]/40 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 shadow-lg shadow-[#D4A72C]/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center shrink-0">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-white">Governança & Guardrails de Inteligência Artificial</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                POLÍTICA LGPD ATIVA
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Os agentes executam chamadas reais no Gemini e operam sob supervisão humana. Primeiros contatos comerciais exigem aprovação expressa.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={`px-2.5 py-1 rounded-lg border font-mono flex items-center gap-1.5 ${
              geminiConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <Sparkles size={12} />
            {integrations?.gemini?.model || 'gemini-4-hydrogen'}: {geminiConnected ? 'Conectado' : integrations?.gemini?.status || 'Não configurado'}
          </span>

          <span
            className={`px-2.5 py-1 rounded-lg border font-mono ${
              metaConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            WhatsApp Meta: {metaConnected ? 'Conectado' : 'Modo Simulação'}
          </span>

          <span
            className={`px-2.5 py-1 rounded-lg border font-mono ${
              placesConnected
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            Places: {placesConnected ? 'Conectado' : 'Desativado'}
          </span>

          {firebaseUser?.emailVerified ? (
            <button
              type="button"
              onClick={() => onSyncFirestore?.()}
              className="px-2.5 py-1 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] font-semibold flex items-center gap-1.5 hover:bg-[#D4A72C]/25 cursor-pointer"
              title="Sincronizar configurações e CRM agora com Firebase Firestore"
            >
              <Database size={12} />
              <span>
                {cloudSyncStatus === 'syncing'
                  ? 'Salvando no Firestore...'
                  : cloudSyncStatus === 'error'
                  ? 'Erro no Sync Firestore'
                  : 'Firestore Conectado'}
              </span>
            </button>
          ) : (
            onConnectFirebase && (
              <button
                type="button"
                onClick={() => onConnectFirebase()}
                className="px-3 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Firestore conectado. Clique para sincronizar sua conta Google manualmente."
              >
                <Database size={12} className="text-[#D4A72C]" />
                <span>
                  {firestoreOnline ? 'Firestore Conectado' : 'Firestore Offline'}
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {agentFeedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            agentFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {agentFeedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{agentFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setAgentFeedback(null)}
            className="text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Two Agents Cards Selection */}
      {safeAgents.length === 0 ? (
        <div className="p-8 rounded-2xl bg-[#11141E] border border-slate-800 text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-slate-800/80 text-[#D4A72C] flex items-center justify-center mx-auto">
            <Bot size={20} />
          </div>
          <div className="text-sm font-bold text-white">Carregando configuração dos Agentes de IA...</div>
          <p className="text-xs text-slate-400">
            Caso nenhum agente esteja disponível, verifique as permissões ou recarregue os dados do servidor.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {safeAgents.map((agent) => {
            const isSelected = activeAgent?.id === agent.id;
            const statusMeta = getStatusMeta(agent.status);
            return (
              <div
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`p-5 rounded-2xl bg-[#11141E] border cursor-pointer transition-all relative overflow-hidden ${
                  isSelected
                    ? 'border-[#D4A72C] shadow-lg shadow-[#D4A72C]/10 bg-gradient-to-br from-[#151926] to-[#11141E]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3.5">
                    <div className="relative">
                      <img
                        src={agent.avatar}
                        alt={agent.name}
                        className="w-14 h-14 rounded-2xl object-cover border-2 border-[#D4A72C]/60 shadow-md"
                      />
                      <span
                        className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#11141E] ${
                          statusMeta.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-white">{agent.name}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${statusMeta.badge}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                      <p className="text-xs text-[#D4A72C] font-medium mt-0.5">{agent.role}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleTestConnection(agent.id)}
                      disabled={testingAgentId === agent.id}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Testar conexão real do agente no Gemini"
                    >
                      {testingAgentId === agent.id ? (
                        <RefreshCw size={11} className="animate-spin text-[#D4A72C]" />
                      ) : (
                        <Activity size={11} className="text-[#D4A72C]" />
                      )}
                      <span>Testar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleAgentStatus(agent)}
                      disabled={togglingStatus === agent.id}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                        agent.status === 'ativo'
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Power size={11} />
                      <span>{agent.status === 'ativo' ? 'Ativo' : 'Ativar'}</span>
                    </button>
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-800/80 text-center text-xs">
                  <div className="p-2 rounded-lg bg-slate-900/60">
                    <div className="font-bold text-white font-mono">{agent.stats?.interactionsToday ?? 0}</div>
                    <div className="text-[10px] text-slate-400">Execuções Hoje</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60">
                    <div className="font-bold text-emerald-400 font-mono">{agent.stats?.leadsHandled ?? 0}</div>
                    <div className="text-[10px] text-slate-400">
                      {agent.id === 'atendente' ? 'Leads Conduzidos' : 'Empresas Auditadas'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60">
                    <div className="font-bold text-[#D4A72C] font-mono">
                      {agent.stats?.accuracyScore ? `${agent.stats.accuracyScore}%` : `${agent.autoReplyThreshold ?? 85}%`}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {agent.stats?.accuracyScore ? 'Assertividade' : 'Limiar Confiança'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending Outreach Approval Queue (Guardrail Feature) */}
      {selectedAgentId === 'prospector' && (
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-[#D4A72C]" />
                <h3 className="text-sm font-bold text-white">
                  Fila de Abordagens Comerciais Aguardando Aprovação ({safePendingLeads.length})
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Revise os diagnósticos e aprove com 1 clique antes do envio da mensagem de primeiro contato pelo WhatsApp oficial.
              </p>
            </div>
          </div>

          {safePendingLeads.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-900/40 rounded-lg border border-slate-800">
              Nenhuma abordagem comercial pendente de aprovação no momento.
            </div>
          ) : (
            <div className="space-y-3">
              {safePendingLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-white">{lead.company}</h4>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {lead.segment}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {lead.city} - {lead.state}
                      </span>
                    </div>

                    <div className="text-[11px] text-amber-300/90 mt-1 flex items-center gap-1.5">
                      <AlertTriangle size={12} />
                      <span>{lead.technicalAudit?.issues?.[0] || 'Empresa sem website oficial cadastrado'}</span>
                    </div>

                    <div className="p-2.5 rounded bg-[#151926] border border-slate-800 text-[11px] text-slate-300 italic mt-2">
                      "{lead.notes?.[0]?.text || `Olá, equipe da ${lead.company}! Identificamos oportunidades de presença digital para sua empresa.`}"
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onApproveColdOutreach(lead.id, lead.notes?.[0]?.text || '')}
                      className="px-3 py-1.5 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer"
                    >
                      <CheckCircle2 size={13} />
                      <span>Aprovar Envio WhatsApp</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Interactive Testing Sandbox (Real Gemini Execution) */}
      {activeAgent && (
        <div className="p-5 rounded-xl bg-[#11141E] border border-[#D4A72C]/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap size={16} className="text-[#D4A72C]" />
                <span>
                  Laboratório de Teste Real — {activeAgent.name}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeAgent.id === 'atendente'
                  ? 'Envie uma mensagem simulada de cliente para validar a resposta real do Gemini com base no seu catálogo e instruções.'
                  : 'Informe uma empresa e site para testar a auditoria HTTP real e a geração de pitch consultivo com o Gemini.'}
              </p>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 shrink-0">
              Modelo ativo: {activeAgent.model || integrations?.gemini?.model || 'gemini-4-hydrogen'}
            </span>
          </div>

          {activeAgent.id === 'atendente' ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <label className="text-xs text-slate-400 shrink-0">Nome do contato teste:</label>
                <input
                  type="text"
                  value={simContactName}
                  onChange={(e) => setSimContactName(e.target.value)}
                  className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D4A72C] sm:w-64"
                />
                {simMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSimMessages([])}
                    className="text-xs text-slate-400 hover:text-white ml-auto"
                  >
                    Limpar histórico do teste
                  </button>
                )}
              </div>

              <div className="bg-[#090B10] border border-slate-800 rounded-xl p-3 space-y-2.5 max-h-64 overflow-y-auto">
                {simMessages.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500">
                    Nenhuma mensagem testada ainda. Envie uma pergunta abaixo (ex: "Qual o valor de um site institucional?").
                  </div>
                ) : (
                  simMessages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.sender === 'contact' ? 'items-start' : 'items-end'}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                          m.sender === 'contact'
                            ? 'bg-[#151926] border border-slate-800 text-slate-200'
                            : 'bg-gradient-to-br from-[#1c2236] to-[#141b2c] border border-[#D4A72C]/40 text-white'
                        }`}
                      >
                        <div className="text-[10px] font-bold mb-1 text-[#D4A72C]">
                          {m.sender === 'contact' ? simContactName : activeAgent.name}
                        </div>
                        <p className="whitespace-pre-line">{m.text}</p>
                        {m.sender === 'agent' && (m.handover || m.suggestedStatus) && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-700/60 flex flex-wrap items-center gap-2 text-[10px] text-slate-300">
                            {m.suggestedStatus && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono">
                                Etapa sugerida: {m.suggestedStatus}
                              </span>
                            )}
                            {m.handover && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                                Transbordo para Humano acionado
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleRunAtendenteSim} className="flex items-center gap-2">
                <input
                  type="text"
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  placeholder="Digite uma mensagem como cliente para testar o Atendente IA..."
                  className="flex-1 bg-[#151926] border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
                />
                <button
                  type="submit"
                  disabled={simRunning || !simMessage.trim()}
                  className="px-4 py-2 rounded-xl bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {simRunning ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>{simRunning ? 'Gerando...' : 'Testar Resposta'}</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleRunProspectorTest} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <input
                  type="text"
                  value={auditCompany}
                  onChange={(e) => setAuditCompany(e.target.value)}
                  placeholder="Nome da empresa *"
                  required
                  className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
                />
                <input
                  type="text"
                  value={auditSegment}
                  onChange={(e) => setAuditSegment(e.target.value)}
                  placeholder="Segmento"
                  className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
                />
                <input
                  type="text"
                  value={auditCity}
                  onChange={(e) => setAuditCity(e.target.value)}
                  placeholder="Cidade"
                  className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
                />
                <input
                  type="text"
                  value={auditWebsite}
                  onChange={(e) => setAuditWebsite(e.target.value)}
                  placeholder="Website (ex: https://...)"
                  className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
                />
                <button
                  type="submit"
                  disabled={auditRunning || !auditCompany.trim()}
                  className="px-4 py-2 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {auditRunning ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>{auditRunning ? 'Auditando...' : 'Executar Auditoria'}</span>
                </button>
              </form>

              {auditResult && (
                <div className="p-4 rounded-xl bg-[#090B10] border border-slate-800 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-[#D4A72C]" />
                      <span className="font-bold text-white">Resultado Técnico Real</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[#D4A72C]">
                        Score: {auditResult.audit?.score ?? 0}/100
                      </span>
                      {auditResult.audit?.httpStatus && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-emerald-300">
                          HTTP {auditResult.audit.httpStatus}
                        </span>
                      )}
                      {auditResult.audit?.responseTimeMs !== undefined && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                          {auditResult.audit.responseTimeMs}ms
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      SSL: <strong className="text-white">{auditResult.audit?.ssl ? 'Sim' : 'Não'}</strong> • Mobile:{' '}
                      <strong className="text-white">{auditResult.audit?.mobileReady ? 'Sim' : 'Não'}</strong>
                    </span>
                  </div>

                  {Array.isArray(auditResult.audit?.issues) && (
                    <ul className="list-disc pl-5 text-slate-300 space-y-0.5">
                      {auditResult.audit.issues.map((issue: string, i: number) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  )}

                  {auditResult.aiInsights && (
                    <div className="p-3 rounded-lg bg-[#151926] border border-slate-800">
                      <div className="text-[11px] font-bold text-[#D4A72C] mb-1">Insights Estratégicos (Gemini)</div>
                      <p className="text-slate-300">{auditResult.aiInsights}</p>
                    </div>
                  )}

                  {auditResult.pitchDraft && (
                    <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30">
                      <div className="text-[11px] font-bold text-emerald-300 mb-1">
                        Sugestão de Pitch para WhatsApp (Aprovação Humana Necessária)
                      </div>
                      <p className="text-slate-200 italic">"{auditResult.pitchDraft}"</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent Instructions, Rules & Personality Editor */}
      {activeAgent && (
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings size={16} className="text-[#D4A72C]" />
                <span>Configuração de Instruções & Personalidade do {activeAgent.name}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Defina o tom de voz, regras operacionais, limites de autonomia e diretrizes de atendimento.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Personalidade & Tom de Voz
              </label>
              <input
                type="text"
                value={editingPersonality}
                onChange={(e) => setEditingPersonality(e.target.value)}
                className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Limiar de Confiança Auto-Resposta ({editingThreshold}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={editingThreshold}
                  onChange={(e) => setEditingThreshold(Number(e.target.value))}
                  className="w-full accent-[#D4A72C] mt-2"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#151926] border border-slate-700/80">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1">
                    <Lock size={12} className="text-[#D4A72C]" />
                    <span>Aprovação Humana</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Exigir revisão no 1º contato</div>
                </div>
                <input
                  type="checkbox"
                  checked={editingRequireApproval}
                  onChange={(e) => setEditingRequireApproval(e.target.checked)}
                  className="w-4 h-4 accent-[#D4A72C] cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Editable Rules */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Regras e Limitações Ativas ({editingRules.length})
            </label>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {editingRules.map((rule, idx) => (
                <span
                  key={idx}
                  className="text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 flex items-center gap-1.5"
                >
                  <span>✓ {rule}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(idx)}
                    className="text-slate-400 hover:text-rose-400 p-0.5 cursor-pointer"
                    title="Remover regra"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRule();
                  }
                }}
                placeholder="Adicionar nova regra operacional (ex: Sempre confirmar domínio antes de fechar)"
                className="flex-1 bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
              />
              <button
                type="button"
                onClick={handleAddRule}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus size={13} />
                <span>Adicionar</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Prompt de Instruções Operacionais (System Prompt)
            </label>
            <textarea
              rows={8}
              value={editingInstructions}
              onChange={(e) => setEditingInstructions(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700 rounded-xl p-3 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="text-[11px] text-slate-400">
              * Persistido no servidor e replicado automaticamente no Firebase Firestore quando conectado.
            </div>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs transition-all shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {savingConfig && <RefreshCw size={13} className="animate-spin" />}
              <span>{savingConfig ? 'Salvando...' : 'Salvar Configurações do Agente'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
