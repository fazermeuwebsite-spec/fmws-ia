import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  MessageSquare,
  FileText,
  AlertTriangle,
  ShieldAlert,
  UserCheck,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Edit3,
  Trash2,
  MapPin,
  CheckCircle2
} from 'lucide-react';
import { KanbanStageConfig, Lead, LeadStatus, PriorityLevel } from '../types';
import { KanbanBoard } from './kanban/KanbanBoard';
import { StageCustomizerModal } from './kanban/StageCustomizerModal';
import { getKanbanTheme } from './kanban/kanbanColors';

interface CrmModuleProps {
  leads: Lead[];
  stages: KanbanStageConfig[];
  onSaveStages: (stages: KanbanStageConfig[]) => Promise<void>;
  onOpenLeadModal: (lead?: Lead) => void;
  onUpdateLeadStatus: (leadId: string, newStatus: LeadStatus) => Promise<void> | void;
  onDeleteLead: (leadId: string) => Promise<void> | void;
  onOpenWhatsApp: (phone: string) => void;
  onOpenProposalModal: (lead: Lead) => void;
  onConvertToClient: (lead: Lead) => void;
  loading?: boolean;
  error?: string | null;
}

const PRIORITY_STYLES: Record<PriorityLevel, { label: string; cls: string }> = {
  baixa: { label: 'Baixa', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  media: { label: 'Média', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  alta: { label: 'Alta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  urgente: { label: 'Urgente', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
};

export const CrmModule: React.FC<CrmModuleProps> = ({
  leads,
  stages,
  onSaveStages,
  onOpenLeadModal,
  onUpdateLeadStatus,
  onDeleteLead,
  onOpenWhatsApp,
  onOpenProposalModal,
  onConvertToClient,
  loading = false,
  error = null
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSegment, setSelectedSegment] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedStageFilter, setSelectedStageFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  const stageMap = new Map<string, KanbanStageConfig>(orderedStages.map((s) => [s.id, s]));

  const segments = Array.from(new Set(leads.map((l) => l.segment).filter(Boolean)));

  const filteredLeads = leads.filter((lead) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      lead.name.toLowerCase().includes(q) ||
      lead.company.toLowerCase().includes(q) ||
      lead.city.toLowerCase().includes(q) ||
      lead.phone.includes(searchTerm);
    const matchesSegment = selectedSegment === 'all' || lead.segment === selectedSegment;
    const matchesPriority = selectedPriority === 'all' || (lead.priority || 'media') === selectedPriority;
    const matchesStage = selectedStageFilter === 'all' || lead.status === selectedStageFilter;
    return matchesSearch && matchesSegment && matchesPriority && matchesStage;
  });

  const itemCountsByStage: Record<string, number> = {};
  for (const lead of leads) {
    itemCountsByStage[lead.status] = (itemCountsByStage[lead.status] || 0) + 1;
  }

  const getStageLabel = (stageId: string) => stageMap.get(stageId)?.label || stageId;

  const renderLeadCard = (lead: Lead) => {
    const prio = PRIORITY_STYLES[lead.priority || 'media'] || PRIORITY_STYLES.media;
    const stageConfig = stageMap.get(lead.status);
    const stageTheme = getKanbanTheme(stageConfig?.color);

    return (
      <div className="p-3.5 rounded-xl bg-[#151926] border border-slate-800/90 hover:border-[#D4A72C]/50 transition-all shadow-sm space-y-2.5 min-w-0">
        {/* Top Row: Company + Priority + Edit/Delete */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <button
            type="button"
            onClick={() => onOpenLeadModal(lead)}
            className="text-left min-w-0 flex-1 group cursor-pointer"
          >
            <h4 className="text-xs font-bold text-white group-hover:text-[#D4A72C] truncate">
              {lead.company}
            </h4>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{lead.name}</p>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${prio.cls}`}>
              {prio.label}
            </span>
            <button
              type="button"
              onClick={() => onOpenLeadModal(lead)}
              className="p-1 rounded text-slate-400 hover:text-[#D4A72C] hover:bg-slate-800 transition-colors cursor-pointer"
              title="Abrir / Editar Lead"
            >
              <Edit3 size={12} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteLead(lead.id)}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Excluir Lead"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Segment & City */}
        <div className="flex items-center justify-between gap-2 text-[11px] min-w-0">
          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 truncate max-w-[130px]">
            {lead.segment || 'Geral'}
          </span>
          <span className="text-slate-400 flex items-center gap-1 truncate">
            <MapPin size={10} className="shrink-0 text-slate-500" />
            <span className="truncate">
              {lead.city}
              {lead.state ? ` - ${lead.state}` : ''}
            </span>
          </span>
        </div>

        {/* Technical Audit + Status Pill */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[10px] min-w-0">
          {lead.technicalAudit?.hasWebsite ? (
            lead.technicalAudit.ssl ? (
              <span className="flex items-center gap-1 text-emerald-400 truncate">
                <CheckCircle2 size={11} className="shrink-0" />
                <span className="truncate">Com Site (SSL)</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400 truncate">
                <AlertTriangle size={11} className="shrink-0" />
                <span className="truncate">Site sem SSL</span>
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 text-rose-400 font-semibold truncate">
              <ShieldAlert size={11} className="shrink-0" />
              <span className="truncate">Sem Website</span>
            </span>
          )}

          <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold truncate max-w-[115px] ${stageTheme.badge}`}>
            {getStageLabel(lead.status)}
          </span>
        </div>

        {/* Value & Quick Actions */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-xs font-bold text-[#D4A72C] font-mono">
            R$ {(lead.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          </span>

          <div className="flex items-center gap-1">
            {lead.whatsapp && (
              <button
                type="button"
                onClick={() => onOpenWhatsApp(lead.whatsapp)}
                className="w-6 h-6 rounded bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Conversar no WhatsApp"
              >
                <MessageSquare size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenProposalModal(lead)}
              className="w-6 h-6 rounded bg-[#D4A72C]/10 hover:bg-[#D4A72C] text-[#D4A72C] hover:text-slate-950 flex items-center justify-center transition-colors cursor-pointer"
              title="Criar Proposta Comercial"
            >
              <FileText size={12} />
            </button>
            {lead.status === 'ganho' && (
              <button
                type="button"
                onClick={() => onConvertToClient(lead)}
                className="w-6 h-6 rounded bg-blue-500/10 hover:bg-blue-500 text-blue-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Converter em Cliente Ativo"
              >
                <UserCheck size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Mobile / Accessible Move Stage Dropdown */}
        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span className="shrink-0">Etapa:</span>
          <select
            value={lead.status}
            onChange={(e) => onUpdateLeadStatus(lead.id, e.target.value as LeadStatus)}
            className="flex-1 min-w-0 bg-[#090B10] border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            {orderedStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Filter & Action Bar */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-[#11141E] p-4 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar empresa, contato, telefone ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <select
            value={selectedSegment}
            onChange={(e) => setSelectedSegment(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            <option value="all">Segmentos ({leads.length})</option>
            {segments.map((seg) => (
              <option key={seg} value={seg}>
                {seg}
              </option>
            ))}
          </select>

          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            <option value="all">Todas Prioridades</option>
            <option value="urgente">Urgente</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>

          <select
            value={selectedStageFilter}
            onChange={(e) => setSelectedStageFilter(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            <option value="all">Todas as Etapas</option>
            {orderedStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCustomizerOpen(true)}
            className="px-3 py-2 rounded-lg bg-[#151926] border border-slate-700 hover:border-[#D4A72C]/60 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <SlidersHorizontal size={14} className="text-[#D4A72C]" />
            <span>Personalizar Etapas</span>
          </button>

          <div className="flex items-center bg-[#151926] border border-slate-700/80 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                viewMode === 'kanban'
                  ? 'bg-[#D4A72C] text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Visualização Kanban"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[#D4A72C] text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Visualização em Lista"
            >
              <List size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenLeadModal()}
            className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
          >
            <Plus size={15} />
            <span>Novo Lead</span>
          </button>
        </div>
      </div>

      {leads.length === 0 && !loading && (
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[#D4A72C] shrink-0" />
            <span>
              Nenhum lead cadastrado no CRM. Clique em <strong>"+ Novo Lead"</strong> para cadastrar a primeira oportunidade ou importe empresas do módulo de <strong>Prospecção</strong>.
            </span>
          </div>
        </div>
      )}

      {/* KANBAN OR LIST VIEW */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          stages={orderedStages}
          items={filteredLeads}
          getItemStage={(lead) => lead.status}
          onMoveItem={(leadId, targetStage) => onUpdateLeadStatus(leadId, targetStage as LeadStatus)}
          renderCard={(lead) => renderLeadCard(lead)}
          renderColumnSummary={(_stage, stageLeads) => {
            const stageTotal = stageLeads.reduce((acc, l) => acc + (Number(l.value) || 0), 0);
            return (
              <div className="text-[11px] font-mono text-[#D4A72C] font-semibold">
                R$ {stageTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            );
          }}
          emptyStageMessage="Arraste um lead para cá"
          loading={loading}
          error={error}
        />
      ) : (
        <div className="bg-[#11141E] rounded-xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#151926] text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Empresa / Contato</th>
                  <th className="py-3 px-4">Segmento</th>
                  <th className="py-3 px-4">Cidade / UF</th>
                  <th className="py-3 px-4">Prioridade</th>
                  <th className="py-3 px-4">Etapa do Funil</th>
                  <th className="py-3 px-4">Valor Estimado</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      {leads.length === 0
                        ? 'Nenhum lead cadastrado no CRM.'
                        : 'Nenhum lead encontrado com os filtros atuais.'}
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => {
                    const prio = PRIORITY_STYLES[lead.priority || 'media'] || PRIORITY_STYLES.media;
                    return (
                      <tr key={lead.id} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => onOpenLeadModal(lead)}
                            className="font-bold text-white hover:text-[#D4A72C] cursor-pointer text-left"
                          >
                            {lead.company}
                          </button>
                          <div className="text-[11px] text-slate-400">
                            {lead.name} {lead.phone ? `• ${lead.phone}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {lead.segment}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {lead.city}
                          {lead.state ? ` - ${lead.state}` : ''}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${prio.cls}`}>
                            {prio.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={lead.status}
                            onChange={(e) => onUpdateLeadStatus(lead.id, e.target.value as LeadStatus)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                          >
                            {orderedStages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-[#D4A72C]">
                          R$ {(lead.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenLeadModal(lead)}
                              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                              title="Editar"
                            >
                              <Edit3 size={13} />
                            </button>
                            {lead.whatsapp && (
                              <button
                                type="button"
                                onClick={() => onOpenWhatsApp(lead.whatsapp)}
                                className="p-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white"
                                title="WhatsApp"
                              >
                                <MessageSquare size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenProposalModal(lead)}
                              className="p-1.5 rounded bg-[#D4A72C]/10 hover:bg-[#D4A72C] text-[#D4A72C] hover:text-slate-950"
                              title="Gerar Proposta"
                            >
                              <FileText size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteLead(lead.id)}
                              className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white"
                              title="Excluir"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {customizerOpen && (
        <StageCustomizerModal
          title="Personalizar Etapas do Funil (CRM)"
          subtitle="Renomeie, reordene, mude as cores ou crie novas colunas para o funil comercial"
          stages={orderedStages}
          itemCountsByStage={itemCountsByStage}
          onClose={() => setCustomizerOpen(false)}
          onSave={onSaveStages}
        />
      )}
    </div>
  );
};
