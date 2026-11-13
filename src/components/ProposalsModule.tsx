import React, { useState } from 'react';
import { 
  FileText, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  Printer, 
  Send, 
  Trash2, 
  ExternalLink,
  DollarSign
} from 'lucide-react';
import { Proposal } from '../types';
import { ProposalPrintModal } from './ProposalPrintModal';

interface ProposalsModuleProps {
  proposals: Proposal[];
  onOpenNewProposal: () => void;
  onApproveProposal: (proposalId: string) => void;
  onDeleteProposal: (proposalId: string) => void;
  onSendWhatsApp: (phone: string, text: string) => void;
}

export const ProposalsModule: React.FC<ProposalsModuleProps> = ({
  proposals,
  onOpenNewProposal,
  onApproveProposal,
  onDeleteProposal,
  onSendWhatsApp
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedProposalForPrint, setSelectedProposalForPrint] = useState<Proposal | null>(null);

  const filteredProposals = proposals.filter(p => {
    const matchesSearch = 
      p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalValue = proposals.reduce((acc, p) => acc + (p.totalValue || 0), 0);
  const pendingApproval = proposals.filter(p => p.status === 'aguardando_aprovacao').length;

  return (
    <div className="space-y-5">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Total Propostas Emitidas</div>
          <div className="text-2xl font-black text-white font-mono mt-1">{proposals.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">Volume acumulado</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Valor Total em Propostas</div>
          <div className="text-2xl font-black text-[#D4A72C] font-mono mt-1">
            R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Pipeline formalizado</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Aguardando Aprovação de Gestor</div>
          <div className="text-2xl font-black text-amber-400 font-mono mt-1">{pendingApproval}</div>
          <div className="text-[11px] text-amber-400/80 mt-1">Exige aprovação antes do envio</div>
        </div>
      </div>

      {/* Filter & Action Bar */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código (PROP-...), cliente ou título..."
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
            <option value="all">Todos os Status</option>
            <option value="aguardando_aprovacao">Aguardando Aprovação ({pendingApproval})</option>
            <option value="aprovada">Aprovada</option>
            <option value="enviada">Enviada ao Cliente</option>
            <option value="aceita">Aceita / Ganha</option>
            <option value="rascunho">Rascunho</option>
          </select>
        </div>

        <button
          onClick={onOpenNewProposal}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
        >
          <Plus size={15} />
          <span>Nova Proposta Comercial</span>
        </button>
      </div>

      {/* Proposals Table */}
      <div className="bg-[#11141E] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#151926] text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Código / Versão</th>
                <th className="py-3 px-4">Cliente / Proposta</th>
                <th className="py-3 px-4">Valor Total</th>
                <th className="py-3 px-4">Prazo Entrega</th>
                <th className="py-3 px-4">Validade</th>
                <th className="py-3 px-4">Status & Governança</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredProposals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                    Nenhuma proposta comercial cadastrada. Crie uma nova proposta pelo botão acima ou a partir de um Lead no CRM.
                  </td>
                </tr>
              ) : filteredProposals.map((prop) => (
                  <tr key={prop.id} className="hover:bg-slate-900/60 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-mono font-bold text-white">{prop.code}</div>
                    <div className="text-[10px] text-slate-400">Versão {prop.version}.0</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-white">{prop.clientName}</div>
                    <div className="text-[11px] text-slate-400 truncate max-w-xs">{prop.title}</div>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-[#D4A72C]">
                    R$ {prop.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {prop.deliveryDays} dias úteis
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {prop.validUntil}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1 items-start">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        prop.status === 'aprovada' ? 'bg-emerald-500/20 text-emerald-300' :
                        prop.status === 'aguardando_aprovacao' ? 'bg-amber-500/20 text-amber-300' :
                        prop.status === 'aceita' ? 'bg-blue-500/20 text-blue-300' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {prop.status.replace('_', ' ')}
                      </span>
                      {prop.approvedBy && (
                        <span className="text-[9px] text-slate-400 flex items-center gap-1">
                          <ShieldCheck size={11} className="text-emerald-400" /> Aprovado por {prop.approvedBy}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {prop.status === 'aguardando_aprovacao' && (
                        <button
                          onClick={() => onApproveProposal(prop.id)}
                          className="px-2.5 py-1 rounded bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-all"
                          title="Aprovação formal antes do envio"
                        >
                          <ShieldCheck size={12} />
                          <span>Aprovar Envio</span>
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedProposalForPrint(prop)}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                        title="Visualizar e Imprimir Proposta / PDF"
                      >
                        <Printer size={13} />
                      </button>

                      <button
                        onClick={() => onSendWhatsApp('', `Olá! Sua proposta comercial ${prop.code} da Fazer Meu Website já foi formalizada no valor de R$ ${prop.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)}
                        className="p-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white transition-colors"
                        title="Enviar link da proposta via WhatsApp"
                      >
                        <Send size={13} />
                      </button>

                      <button
                        onClick={() => onDeleteProposal(prop.id)}
                        className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-colors"
                        title="Excluir Proposta"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proposal Print Preview Modal */}
      {selectedProposalForPrint && (
        <ProposalPrintModal
          proposal={selectedProposalForPrint}
          onClose={() => setSelectedProposalForPrint(null)}
          onSendWhatsApp={onSendWhatsApp}
        />
      )}
    </div>
  );
};
