import React from 'react';
import {
  LayoutDashboard,
  Users,
  Radar,
  MessageSquare,
  Building2,
  FileText,
  KanbanSquare,
  DollarSign,
  LifeBuoy,
  Bot,
  BarChart3,
  Settings,
  Sparkles,
  LogOut
} from 'lucide-react';
import { User, AIAgentConfig, SystemIntegrations } from '../types';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: User;
  permissions: string[];
  onLogout: () => void;
  unreadWhatsApp: number;
  pendingProposals: number;
  openTickets: number;
  pendingOutreach: number;
  aiAgents?: AIAgentConfig[];
  integrations?: SystemIntegrations;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  currentUser,
  permissions,
  onLogout,
  unreadWhatsApp,
  pendingProposals,
  openTickets,
  pendingOutreach,
  aiAgents
}) => {
  const atendente = aiAgents?.find((a) => a.id === 'atendente');
  const prospector = aiAgents?.find((a) => a.id === 'prospector');

  const atendenteStatusText =
    atendente?.status === 'ativo'
      ? 'Ativo'
      : atendente?.status === 'pausado'
      ? 'Pausado'
      : atendente?.status === 'em_treinamento'
      ? 'Em Treinamento'
      : 'Não configurado';

  const prospectorStatusText =
    prospector?.status === 'ativo'
      ? 'Ativo'
      : prospector?.status === 'pausado'
      ? 'Pausado'
      : prospector?.status === 'em_treinamento'
      ? 'Em Treinamento'
      : 'Não configurado';

  const anyAgentConfigured = atendente?.status === 'ativo' || prospector?.status === 'ativo';

  const hasPerm = (perm?: string) => {
    if (!perm || currentUser.role === 'admin') return true;
    return permissions.includes('*') || permissions.includes(perm);
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'crm', label: 'CRM & Funil', icon: Users, perm: 'crm.read' },
    {
      id: 'prospecting',
      label: 'Prospecção & Radar',
      icon: Radar,
      perm: 'prospecting.read',
      badge: pendingOutreach > 0 ? `${pendingOutreach} pend.` : undefined,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp Oficial',
      icon: MessageSquare,
      perm: 'whatsapp.read',
      badge: unreadWhatsApp > 0 ? `${unreadWhatsApp}` : undefined,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    },
    { id: 'clients', label: 'Clientes & Host', icon: Building2, perm: 'clients.read' },
    {
      id: 'proposals',
      label: 'Propostas Comerciais',
      icon: FileText,
      perm: 'proposals.read',
      badge: pendingProposals > 0 ? `${pendingProposals}` : undefined,
      badgeColor: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
    },
    { id: 'projects', label: 'Projetos Web', icon: KanbanSquare, perm: 'projects.read' },
    { id: 'financial', label: 'Financeiro & Asaas', icon: DollarSign, perm: 'financial.read' },
    {
      id: 'support',
      label: 'Suporte & SLA',
      icon: LifeBuoy,
      perm: 'support.read',
      badge: openTickets > 0 ? `${openTickets}` : undefined,
      badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30'
    },
    {
      id: 'ai_agents',
      label: 'Funcionários de IA',
      icon: Bot,
      perm: 'agents.read',
      highlight: true
    },
    { id: 'reports', label: 'Relatórios & BI', icon: BarChart3, perm: 'reports.read' },
    { id: 'settings', label: 'Configurações', icon: Settings, perm: 'settings.read' }
  ].filter((item) => hasPerm(item.perm));

  return (
    <aside className="w-64 bg-[#090B10] border-r border-slate-800/80 flex flex-col h-screen select-none shrink-0 z-30">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D4A72C] via-[#B88E1E] to-[#7A5B0B] p-[1.5px] shadow-lg shadow-[#D4A72C]/10 flex items-center justify-center">
          <div className="w-full h-full bg-[#090B10] rounded-[10px] flex items-center justify-center">
            <span className="font-extrabold text-[#D4A72C] text-sm tracking-tighter">FMWS</span>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-black text-white tracking-wide text-base">FMWS</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#D4A72C]/20 text-[#D4A72C] border border-[#D4A72C]/40">
              SALES AI
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Fazer Meu Website</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Operações Comerciais
        </div>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-[#D4A72C]/20 to-[#D4A72C]/5 text-white border-l-2 border-[#D4A72C] shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  size={18}
                  className={`transition-colors shrink-0 ${
                    isActive ? 'text-[#D4A72C]' : 'text-slate-400 group-hover:text-slate-300'
                  }`}
                />
                <span className={`truncate ${isActive ? 'font-semibold text-white' : ''}`}>
                  {item.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {item.highlight && (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#D4A72C]/20 text-[#D4A72C] border border-[#D4A72C]/30">
                    <Sparkles size={10} /> 2 IAs
                  </span>
                )}
                {item.badge && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </nav>

      {/* AI Agents Real Status Mini-card */}
      <div className="px-3 py-3 mx-3 mb-3 bg-[#11141E] border border-slate-800 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                anyAgentConfigured ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
              }`}
            />
            <span className="text-[11px] font-semibold text-slate-300">Agentes Autônomos</span>
          </div>
          <span
            className={`text-[10px] font-mono ${
              anyAgentConfigured ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            {anyAgentConfigured ? 'OPERANTE' : 'PENDENTE'}
          </span>
        </div>
        <div className="text-[11px] text-slate-400 space-y-1">
          <div className="flex justify-between items-center">
            <span>Atendente IA:</span>
            <span
              className={
                atendente?.status === 'ativo'
                  ? 'text-emerald-400 font-medium'
                  : 'text-slate-400 font-medium'
              }
            >
              {atendenteStatusText}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Prospector IA:</span>
            <span
              className={
                prospector?.status === 'ativo'
                  ? 'text-[#D4A72C] font-medium'
                  : 'text-slate-400 font-medium'
              }
            >
              {prospectorStatusText}
            </span>
          </div>
        </div>
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-[#0c0f17]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-8 h-8 rounded-full border border-[#D4A72C]/40 object-cover shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-white leading-tight truncate">
                {currentUser.name}
              </span>
              <span className="text-[10px] uppercase font-bold text-[#D4A72C]">
                {currentUser.role}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 cursor-pointer shrink-0"
            title="Sair do sistema"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};
