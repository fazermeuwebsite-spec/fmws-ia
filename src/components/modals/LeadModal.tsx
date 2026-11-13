import React, { useState } from 'react';
import { X, Users, Trash2, History, MessageSquarePlus, AlertTriangle } from 'lucide-react';
import { KanbanStageConfig, Lead, LeadStatus, PriorityLevel } from '../../types';

interface LeadModalProps {
  lead?: Lead | null;
  stages: KanbanStageConfig[];
  currentUserName: string;
  onClose: () => void;
  onSave: (leadData: Partial<Lead>) => Promise<void> | void;
  onDelete?: (leadId: string) => Promise<void> | void;
}

export const LeadModal: React.FC<LeadModalProps> = ({
  lead,
  stages,
  currentUserName,
  onClose,
  onSave,
  onDelete
}) => {
  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  const defaultStage = orderedStages[0]?.id || 'novo';

  const [name, setName] = useState(lead?.name || '');
  const [company, setCompany] = useState(lead?.company || '');
  const [email, setEmail] = useState(lead?.email || '');
  const [phone, setPhone] = useState(lead?.phone || '');
  const [whatsapp, setWhatsapp] = useState(lead?.whatsapp || '');
  const [segment, setSegment] = useState(lead?.segment || 'Odontologia');
  const [city, setCity] = useState(lead?.city || 'São Paulo');
  const [state, setState] = useState(lead?.state || 'SP');
  const [websiteUrl, setWebsiteUrl] = useState(lead?.websiteUrl || '');
  const [value, setValue] = useState(lead?.value !== undefined ? String(lead.value) : '0');
  const [status, setStatus] = useState<LeadStatus>(lead?.status || defaultStage);
  const [priority, setPriority] = useState<PriorityLevel>(lead?.priority || 'media');
  const [hasWebsite, setHasWebsite] = useState(lead?.technicalAudit?.hasWebsite ?? false);
  const [ssl, setSsl] = useState(lead?.technicalAudit?.ssl ?? false);
  const [techScore, setTechScore] = useState(
    lead?.technicalAudit?.score !== undefined ? String(lead.technicalAudit.score) : '0'
  );
  const [newNote, setNewNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const cleanWhatsapp = whatsapp ? whatsapp.replace(/\D/g, '') : cleanPhone ? `55${cleanPhone}` : '';

      const existingNotes = Array.isArray(lead?.notes) ? [...lead.notes] : [];
      if (newNote.trim()) {
        existingNotes.unshift({
          id: `note_${Date.now()}`,
          author: currentUserName,
          text: newNote.trim(),
          createdAt: new Date().toISOString()
        });
      }

      const leadPayload: Partial<Lead> = {
        ...(lead ? { id: lead.id } : {}),
        name: name.trim(),
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
        whatsapp: cleanWhatsapp,
        segment,
        city: city.trim(),
        state,
        websiteUrl: websiteUrl.trim(),
        value: parseFloat(value) || 0,
        status,
        priority,
        notes: existingNotes,
        technicalAudit: {
          ...(lead?.technicalAudit || {}),
          score: Math.min(100, Math.max(0, parseInt(techScore, 10) || 0)),
          hasWebsite,
          ssl,
          mobileReady: lead?.technicalAudit?.mobileReady ?? false,
          speedScore: lead?.technicalAudit?.speedScore ?? 0,
          domainAvailable: !hasWebsite,
          issues:
            lead?.technicalAudit?.issues?.length
              ? lead.technicalAudit.issues
              : hasWebsite
              ? ['Site informado — recomenda-se auditoria técnica individual']
              : ['Empresa sem website informado'],
          recommendedService:
            lead?.technicalAudit?.recommendedService ||
            (hasWebsite ? 'Reformulação & Otimização Web' : 'Criação de Website Institucional')
        },
        tags: [segment, hasWebsite ? 'Com Site' : 'Sem Site'],
        assignedTo: lead?.assignedTo || currentUserName,
        source: lead?.source || 'manual',
        campaignStatus: lead?.campaignStatus || 'pendente_aprovacao'
      };

      await onSave(leadPayload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!lead || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(lead.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <Users size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {lead ? `Editar Lead: ${lead.company}` : 'Cadastrar Novo Lead Comercial'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Dados comerciais, etapa do funil, prioridade e histórico
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Nome da Empresa *</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Ex: Clínica Sorriso Real"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Nome do Contato / Decisor *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Dr. Marcelo Ramos"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Etapa do Funil</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              >
                {orderedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              >
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Telefone Principal *</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 98765-4321"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">WhatsApp (com DDI/DDD)</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Ex: 5511987654321"
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">E-mail Comercial</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Segmento</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="Odontologia">Odontologia & Saúde</option>
                <option value="Advocacia">Advocacia & Direito</option>
                <option value="Gastronomia">Gastronomia & Restaurantes</option>
                <option value="Engenharia">Engenharia & Arquitetura</option>
                <option value="E-commerce">Comércio Eletrônico</option>
                <option value="Varejo / Serviços">Varejo & Serviços Gerais</option>
                <option value="Saúde / Clínicas">Clínicas & Estética</option>
                <option value="Imobiliário">Imobiliário & Construção</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Cidade</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="São Paulo"
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Estado (UF)</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="SP">SP</option>
                <option value="RJ">RJ</option>
                <option value="MG">MG</option>
                <option value="PR">PR</option>
                <option value="RS">RS</option>
                <option value="SC">SC</option>
                <option value="BA">BA</option>
                <option value="DF">DF</option>
                <option value="GO">GO</option>
                <option value="PE">PE</option>
                <option value="CE">CE</option>
              </select>
            </div>
          </div>

          {/* Technical presence diagnosis */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <span className="font-bold text-[#D4A72C] text-[11px] uppercase tracking-wider block">
              Presença Web & Valor da Oportunidade
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Possui Website Ativo?</label>
                <select
                  value={hasWebsite ? 'sim' : 'nao'}
                  onChange={(e) => setHasWebsite(e.target.value === 'sim')}
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="nao">Não (Oportunidade de Criação Nova)</option>
                  <option value="sim">Sim (Oportunidade de Redesign/Hospedagem)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Endereço Web Atual (se houver)</label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://www.empresa.com.br"
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Score Técnico Observado (0-100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={techScore}
                  onChange={(e) => setTechScore(e.target.value)}
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Valor da Oportunidade (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-[#D4A72C] font-mono font-bold"
                />
              </div>
            </div>

            {hasWebsite && (
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={ssl}
                  onChange={(e) => setSsl(e.target.checked)}
                  className="accent-[#D4A72C]"
                />
                <span>Site possui certificado HTTPS/SSL válido</span>
              </label>
            )}
          </div>

          {/* Add Observation */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <MessageSquarePlus size={13} className="text-[#D4A72C]" />
              <span>Adicionar Observação Comercial</span>
            </label>
            <textarea
              rows={2}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Anote detalhes da reunião, objeções ou próximos passos..."
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          {/* Existing Notes & History when editing */}
          {lead && ((lead.notes && lead.notes.length > 0) || (lead.history && lead.history.length > 0)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800 space-y-2">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Observações ({lead.notes?.length || 0})
                </span>
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {lead.notes?.length ? (
                    lead.notes.map((n) => (
                      <div key={n.id} className="p-2 rounded bg-slate-900/70 border border-slate-800/80">
                        <p className="text-slate-200 text-[11px]">{n.text}</p>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {n.author} • {new Date(n.createdAt).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 italic text-[11px]">Sem observações.</p>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800 space-y-2">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <History size={12} className="text-[#D4A72C]" />
                  <span>Histórico ({lead.history?.length || 0})</span>
                </span>
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {lead.history?.length ? (
                    lead.history.map((h) => (
                      <div key={h.id} className="p-2 rounded bg-slate-900/70 border border-slate-800/80">
                        <p className="text-slate-200 text-[11px]">{h.action}</p>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {h.user} • {new Date(h.date).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 italic text-[11px]">Sem movimentações registradas.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <div>
              {lead && onDelete && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Excluir Lead</span>
                </button>
              )}
              {lead && onDelete && confirmDelete && (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 px-2.5 py-1.5 rounded-lg">
                  <AlertTriangle size={13} className="text-rose-400" />
                  <span className="text-rose-200 font-semibold">Confirmar exclusão?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold hover:bg-rose-500 cursor-pointer"
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    Não
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar Lead no CRM'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
