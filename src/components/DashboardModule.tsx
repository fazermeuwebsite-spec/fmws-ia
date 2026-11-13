import React from 'react';
import { 
  Users, 
  TrendingUp, 
  DollarSign, 
  MessageSquare, 
  KanbanSquare, 
  LifeBuoy, 
  ArrowUpRight, 
  Sparkles, 
  Bot, 
  ShieldAlert, 
  CheckCircle2, 
  Clock, 
  ExternalLink,
  ChevronRight,
  Globe2
} from 'lucide-react';
import { 
  Lead, 
  Client, 
  WhatsAppConversation, 
  Proposal, 
  Project, 
  FinancialTransaction, 
  SupportTicket, 
  AIAgentConfig, 
  SystemIntegrations 
} from '../types';

interface DashboardProps {
  metrics: any;
  leads: Lead[];
  clients: Client[];
  whatsappConversations: WhatsAppConversation[];
  proposals: Proposal[];
  projects: Project[];
  financial: FinancialTransaction[];
  supportTickets: SupportTicket[];
  aiAgents?: AIAgentConfig[];
  integrations?: SystemIntegrations;
  onNavigate: (tab: string) => void;
  onApproveOutreach: (lead: Lead) => void;
}

export const DashboardModule: React.FC<DashboardProps> = ({
  metrics,
  leads,
  clients,
  whatsappConversations,
  proposals,
  projects,
  financial,
  supportTickets,
  aiAgents,
  integrations,
  onNavigate,
  onApproveOutreach
}) => {
  const atendente = aiAgents?.find(a => a.id === 'atendente');
  const prospector = aiAgents?.find(a => a.id === 'prospector');

  const atendenteStatusText = 
    atendente?.status === 'ativo' ? 'ATIVO 24/7' :
    atendente?.status === 'pausado' ? 'PAUSADO' :
    atendente?.status === 'erro' ? 'ERRO NA API' :
    atendente?.status === 'em_treinamento' ? 'EM TREINAMENTO' : 'NÃO CONFIGURADO';

  const prospectorStatusText = 
    prospector?.status === 'ativo' ? 'RADAR ATIVO' :
    prospector?.status === 'pausado' ? 'PAUSADO' :
    prospector?.status === 'erro' ? 'ERRO NA API' :
    prospector?.status === 'em_treinamento' ? 'EM TREINAMENTO' : 'NÃO CONFIGURADO';
  const pendingApprovals = leads.filter(l => l.campaignStatus === 'pendente_aprovacao');
  const recentLeads = leads.slice(0, 5);
  const activeConversations = whatsappConversations.filter(c => c.status === 'ai_active');

  const totalMRR = clients.reduce((acc, c) => acc + (c.mrr || 0), 0);
  const totalPipeline = leads.filter(l => l.status !== 'perdido').reduce((acc, l) => acc + (l.value || 0), 0);
  const totalWon = leads.filter(l => l.status === 'ganho').reduce((acc, l) => acc + (l.value || 0), 0);
  const paidRevenue = financial.filter(f => f.type === 'receita' && f.status === 'pago').reduce((acc, f) => acc + f.value, 0);

  // Status breakdown
  const statusCounts = {
    novo: leads.filter(l => l.status === 'novo').length,
    qualificacao: leads.filter(l => l.status === 'qualificacao').length,
    apresentacao: leads.filter(l => l.status === 'apresentacao').length,
    proposta: leads.filter(l => l.status === 'proposta').length,
    negociacao: leads.filter(l => l.status === 'negociacao').length,
    ganho: leads.filter(l => l.status === 'ganho').length,
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Alert if pending cold outreach campaigns require approval */}
      {pendingApprovals.length > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-amber-950/40 via-[#151926] to-amber-950/20 border border-[#D4A72C]/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg shadow-[#D4A72C]/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center shrink-0">
              <ShieldAlert size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">
                  {pendingApprovals.length} Prospecções Aguardando Aprovação Humana
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#D4A72C]/20 text-[#D4A72C] font-semibold border border-[#D4A72C]/30">
                  Guardrail de Segurança Ativo
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                O <strong>Prospector IA</strong> localizou novas empresas com falhas técnicas (sem site ou SSL). Revise e autorize o primeiro contato comercial pelo WhatsApp.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('prospecting')}
            className="px-4 py-2 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs transition-all shrink-0 cursor-pointer flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/20"
          >
            <span>Revisar Abordagens</span>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pipeline Value */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80 hover:border-[#D4A72C]/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pipeline Ativo</span>
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/10 text-[#D4A72C] flex items-center justify-center">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-white font-mono">
              R$ {totalPipeline.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
              <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                <ArrowUpRight size={14} /> {leads.length} leads
              </span>
              <span>em negociação</span>
            </div>
          </div>
        </div>

        {/* MRR Recorrente */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">MRR Hospedagem & VIP</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign size={16} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-white font-mono">
              R$ {totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
              <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                <ArrowUpRight size={14} /> {clients.filter(c => c.status === 'ativo').length} clientes ativos
              </span>
              <span>recorrentes</span>
            </div>
          </div>
        </div>

        {/* Faturamento Pago */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80 hover:border-blue-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recebido este Mês</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-white font-mono">
              R$ {paidRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
              <span className="text-blue-400 font-semibold">Asaas & PIX</span>
              <span>conciliados</span>
            </div>
          </div>
        </div>

        {/* WhatsApp & Suporte */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Atendimentos Ativos</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <MessageSquare size={16} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-white font-mono">
              {whatsappConversations.length}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
              <span className="text-purple-400 font-semibold">
                {activeConversations.length} com Atendente IA
              </span>
              <span>• {supportTickets.filter(t => t.status !== 'resolvido').length} chamados</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Autonomous AI Agents Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Atendente IA Card */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/90 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4A72C]/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80"
                  alt="Atendente IA"
                  className="w-12 h-12 rounded-xl object-cover border border-[#D4A72C]/50 shadow-md"
                />
                <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#11141E] ${
                  atendente?.status === 'ativo' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
                }`}></span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">Atendente IA FMWS</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    atendente?.status === 'ativo' 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {atendenteStatusText}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Atendimento WhatsApp Oficial • Qualificação de Leads • Gemini 3.8
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('whatsapp')}
              className="text-xs text-[#D4A72C] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
            >
              <span>Ver Conversas</span>
              <ExternalLink size={12} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-800/70 text-center">
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-white font-mono">{atendente?.stats?.interactionsToday || 0}</div>
              <div className="text-[10px] text-slate-400">Chats Hoje</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-emerald-400 font-mono">{atendente?.stats?.leadsHandled || 0}</div>
              <div className="text-[10px] text-slate-400">Leads Conduzidos</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-[#D4A72C] font-mono">
                {atendente?.stats?.accuracyScore ? `${atendente.stats.accuracyScore}%` : 'Sem dados'}
              </div>
              <div className="text-[10px] text-slate-400">Precisão</div>
            </div>
          </div>
        </div>

        {/* Prospector IA Card */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/90 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80"
                  alt="Prospector IA"
                  className="w-12 h-12 rounded-xl object-cover border border-[#D4A72C]/50 shadow-md"
                />
                <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#11141E] ${
                  prospector?.status === 'ativo' ? 'bg-amber-500' : 'bg-slate-500'
                }`}></span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">Prospector IA FMWS</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    prospector?.status === 'ativo'
                      ? 'bg-[#D4A72C]/20 text-[#D4A72C] border-[#D4A72C]/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {prospectorStatusText}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Auditoria de Empresas • Diagnóstico Técnico • Preparação de Pitch
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('prospecting')}
              className="text-xs text-[#D4A72C] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
            >
              <span>Abrir Radar</span>
              <ExternalLink size={12} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-800/70 text-center">
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-white font-mono">{prospector?.stats?.interactionsToday || 0}</div>
              <div className="text-[10px] text-slate-400">Auditadas Hoje</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-amber-400 font-mono">{prospector?.stats?.leadsHandled || 0}</div>
              <div className="text-[10px] text-slate-400">Sem Site / Falhas</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60">
              <div className="text-lg font-bold text-[#D4A72C] font-mono">
                {prospector?.status === 'ativo' ? 'Guardrail Ativo' : 'Aprovação Humana'}
              </div>
              <div className="text-[10px] text-slate-400">Controle Gestor</div>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Pipeline Conversion Bar */}
      <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Funil Comercial FMWS (Distribuição de Leads)</h3>
            <p className="text-xs text-slate-400">Volume de oportunidades ativas em cada etapa do processo de vendas</p>
          </div>
          <button
            onClick={() => onNavigate('crm')}
            className="text-xs text-[#D4A72C] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>Ver Kanban Completo</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Funnel Stage Metric Blocks */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">1. Novos Leads</div>
            <div className="text-xl font-bold text-white font-mono mt-1">{statusCounts.novo}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-slate-400 h-full" style={{ width: `${Math.min(100, statusCounts.novo * 25)}%` }}></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">2. Qualificação</div>
            <div className="text-xl font-bold text-blue-400 font-mono mt-1">{statusCounts.qualificacao}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-blue-400 h-full" style={{ width: `${Math.min(100, statusCounts.qualificacao * 25)}%` }}></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">3. Apresentação</div>
            <div className="text-xl font-bold text-indigo-400 font-mono mt-1">{statusCounts.apresentacao}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-indigo-400 h-full" style={{ width: `${Math.min(100, statusCounts.apresentacao * 25)}%` }}></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">4. Proposta Enviada</div>
            <div className="text-xl font-bold text-[#D4A72C] font-mono mt-1">{statusCounts.proposta}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-[#D4A72C] h-full" style={{ width: `${Math.min(100, statusCounts.proposta * 25)}%` }}></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">5. Negociação</div>
            <div className="text-xl font-bold text-amber-400 font-mono mt-1">{statusCounts.negociacao}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-amber-400 h-full" style={{ width: `${Math.min(100, statusCounts.negociacao * 25)}%` }}></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-center">
            <div className="text-xs text-slate-400">6. Fechado / Ganho</div>
            <div className="text-xl font-bold text-emerald-400 font-mono mt-1">{statusCounts.ganho}</div>
            <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-emerald-400 h-full" style={{ width: `${Math.min(100, statusCounts.ganho * 25)}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Recent Opportunities & Ongoing Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent High-Priority Leads */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Users size={16} className="text-[#D4A72C]" />
              <span>Oportunidades em Destaque</span>
            </h3>
            <button
              onClick={() => onNavigate('crm')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Ver todos ({leads.length})
            </button>
          </div>
          <div className="space-y-2.5">
            {recentLeads.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/30 rounded-lg border border-slate-800/60">
                Nenhum lead cadastrado no momento. Cadastre novas oportunidades no CRM ou utilize o Radar de Prospecção.
              </div>
            ) : (
              recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/70 hover:border-slate-700 flex items-center justify-between transition-colors"
                >
                  <div className="flex flex-col min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white truncate">{lead.company}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {lead.segment}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span>{lead.name}</span>
                      <span>•</span>
                      <span>{lead.city} - {lead.state}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-[#D4A72C] font-mono">
                      R$ {lead.value?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <span className={`inline-block text-[10px] font-semibold uppercase mt-0.5 px-2 py-0.5 rounded ${
                      lead.status === 'proposta' ? 'bg-[#D4A72C]/20 text-[#D4A72C]' :
                      lead.status === 'negociacao' ? 'bg-amber-500/20 text-amber-300' :
                      lead.status === 'ganho' ? 'bg-emerald-500/20 text-emerald-300' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {lead.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Ongoing Web Projects */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <KanbanSquare size={16} className="text-[#D4A72C]" />
              <span>Projetos Web em Andamento</span>
            </h3>
            <button
              onClick={() => onNavigate('projects')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Ver Kanban ({projects.length})
            </button>
          </div>
          <div className="space-y-3">
            {projects.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/30 rounded-lg border border-slate-800/60">
                Nenhum projeto web em andamento. Inicie um novo projeto ou converta uma proposta aceita.
              </div>
            ) : (
              projects.map((proj) => (
                <div
                  key={proj.id}
                  className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800/70 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{proj.title}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-[#D4A72C]/20 text-[#D4A72C]">
                      {proj.stage.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                    <span>Cliente: <strong className="text-slate-300">{proj.clientName}</strong></span>
                    <span>Prazo: {proj.deadline}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Progresso de Entrega</span>
                      <span className="font-mono text-[#D4A72C] font-bold">{proj.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[#D4A72C] to-amber-300 h-full transition-all"
                        style={{ width: `${proj.progress}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
