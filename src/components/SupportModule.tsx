import React, { useState } from 'react';
import { 
  LifeBuoy, 
  Plus, 
  Search, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Send, 
  User, 
  Building2,
  ExternalLink
} from 'lucide-react';
import { SupportTicket } from '../types';

interface SupportModuleProps {
  tickets: SupportTicket[];
  onOpenNewTicket: () => void;
  onUpdateTicketStatus: (ticketId: string, status: SupportTicket['status']) => void;
  onAddNote: (ticketId: string, noteText: string) => void;
  onOpenWhatsApp: (phone: string) => void;
}

export const SupportModule: React.FC<SupportModuleProps> = ({
  tickets,
  onOpenNewTicket,
  onUpdateTicketStatus,
  onAddNote,
  onOpenWhatsApp
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(tickets[0] || null);
  const [newNoteText, setNewNoteText] = useState('');

  const filteredTickets = tickets.filter(t => {
    const matchesSearch = 
      t.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.clientName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSendNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim() || !selectedTicket) return;
    onAddNote(selectedTicket.id, newNoteText.trim());
    setNewNoteText('');
  };

  const openTicketsCount = tickets.filter(t => t.status !== 'resolvido').length;

  return (
    <div className="space-y-4">
      {/* Header filter */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código (TKT-...), assunto ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">Todos os Chamados</option>
            <option value="aberto">Abertos</option>
            <option value="em_atendimento">Em Atendimento</option>
            <option value="aguardando_cliente">Aguardando Cliente</option>
            <option value="resolvido">Resolvidos</option>
          </select>
        </div>

        <button
          onClick={onOpenNewTicket}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
        >
          <Plus size={15} />
          <span>Abrir Novo Chamado</span>
        </button>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Ticket List (5 cols) */}
        <div className="lg:col-span-5 bg-[#11141E] border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80 max-h-[calc(100vh-210px)] overflow-y-auto">
          {filteredTickets.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <LifeBuoy size={24} className="mx-auto text-slate-600 mb-1" />
              <div className="font-semibold text-slate-300">Nenhum chamado de suporte</div>
              <p className="text-[11px] text-slate-500">
                Abra um novo chamado pelo botão acima quando um cliente solicitar suporte técnico.
              </p>
            </div>
          ) : (
            filteredTickets.map((t) => {
              const isSelected = selectedTicket?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicket(t)}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#151926] border-l-4 border-[#D4A72C]' : 'hover:bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#D4A72C]">{t.code}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                        t.priority === 'critica' ? 'bg-rose-500/20 text-rose-300' :
                        t.priority === 'alta' ? 'bg-amber-500/20 text-amber-300' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {t.priority}
                      </span>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                      t.status === 'resolvido' ? 'bg-emerald-500/20 text-emerald-300' :
                      t.status === 'em_atendimento' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-white mt-1 truncate">{t.subject}</h4>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center justify-between">
                    <span>{t.clientName}</span>
                    <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Ticket Workspace (7 cols) */}
        <div className="lg:col-span-7 bg-[#11141E] border border-slate-800 rounded-xl p-5 space-y-4">
          {selectedTicket ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-[#D4A72C]">{selectedTicket.code}</span>
                    <h3 className="text-base font-bold text-white">{selectedTicket.subject}</h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                    <span>Cliente: <strong className="text-slate-200">{selectedTicket.clientName}</strong></span>
                    <span>•</span>
                    <button
                      onClick={() => onOpenWhatsApp(selectedTicket.contactPhone)}
                      className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <MessageSquare size={12} />
                      <span>{selectedTicket.contactPhone}</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => onUpdateTicketStatus(selectedTicket.id, e.target.value as any)}
                    className="bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="aberto">Aberto</option>
                    <option value="em_atendimento">Em Atendimento</option>
                    <option value="aguardando_cliente">Aguardando Cliente</option>
                    <option value="resolvido">Resolvido ✓</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 text-xs text-slate-200 leading-relaxed">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Descrição do Problema:</span>
                <p>{selectedTicket.description}</p>
              </div>

              {/* Notes History */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Histórico de Atendimento</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedTicket.notes?.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-400 italic">Nenhuma anotação registrada ainda.</div>
                  ) : (
                    selectedTicket.notes?.map((n, i) => (
                      <div key={i} className="p-3 rounded-lg bg-[#151926] border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-[#D4A72C]">{n.author}</span>
                          <span className="text-slate-400">{new Date(n.createdAt).toLocaleString('pt-BR')}</span>
                        </div>
                        <p className="text-slate-300">{n.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Add Note Form */}
              <form onSubmit={handleSendNote} className="pt-2 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Adicionar nota interna ou resposta técnica..."
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  className="flex-1 bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
                />
                <button
                  type="submit"
                  disabled={!newNoteText.trim()}
                  className="px-3 py-2 rounded-lg bg-[#D4A72C] text-slate-950 font-bold text-xs hover:brightness-110 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                >
                  <Send size={12} />
                  <span>Registrar</span>
                </button>
              </form>
            </>
          ) : (
            <div className="p-8 text-center text-xs text-slate-400">
              Selecione um chamado ao lado para ver o histórico
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
