import React from 'react';
import { 
  X, 
  Printer, 
  Send, 
  CheckCircle, 
  Building2, 
  ShieldCheck, 
  Calendar, 
  Clock, 
  FileText 
} from 'lucide-react';
import { Proposal } from '../types';
import { formatDateBR } from '../utils/dateFormat';

interface ProposalPrintModalProps {
  proposal: Proposal;
  onClose: () => void;
  onSendWhatsApp: (phone: string, text: string) => void;
}

export const ProposalPrintModal: React.FC<ProposalPrintModalProps> = ({
  proposal,
  onClose,
  onSendWhatsApp
}) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#11141E] border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-6">
        {/* Top Control Bar (Hidden when printing) */}
        <div className="p-4 bg-[#151926] border-b border-slate-800 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm">Visualização de Proposta Comercial</span>
            <span className="text-xs font-mono font-semibold text-[#D4A72C]">{proposal.code}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer size={14} />
              <span>Imprimir / Gerar PDF</span>
            </button>
            <button
              onClick={() => onSendWhatsApp('', `Olá! Segue o link da sua proposta comercial ${proposal.code} da Fazer Meu Website no valor de R$ ${proposal.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Send size={14} />
              <span>Enviar via WhatsApp</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Printable Paper Canvas */}
        <div className="p-8 sm:p-12 bg-white text-slate-900 font-sans print:p-0">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-[#D4A72C] pb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-slate-950 tracking-tight">FAZER MEU WEBSITE</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#D4A72C] text-slate-950 font-bold uppercase">
                  SOLUÇÕES DIGITAIS
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Desenvolvimento Web • Hospedagem Cloud • E-commerce & SEO
              </p>
              <p className="text-[11px] text-slate-500">
                Av. Paulista, 1000 - Bela Vista, São Paulo - SP | CNPJ: 38.123.456/0001-90
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Proposta Comercial</div>
              <div className="text-lg font-bold font-mono text-[#B88E1E]">{proposal.code}</div>
              <div className="text-xs text-slate-600 mt-1">
                Data de Emissão: <strong>{formatDateBR(proposal.createdAt)}</strong>
              </div>
              <div className="text-xs text-slate-600">
                Validade: <strong>{formatDateBR(proposal.validUntil)}</strong>
              </div>
            </div>
          </div>

          {/* Client & Scope Info */}
          <div className="grid grid-cols-2 gap-6 my-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 font-bold uppercase text-[10px] block">Apresentado a:</span>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">{proposal.clientName}</h3>
              <p className="text-slate-600 mt-0.5">Prazo estimado de entrega: <strong>{proposal.deliveryDays} dias úteis</strong></p>
            </div>
            <div>
              <span className="text-slate-500 font-bold uppercase text-[10px] block">Consultor Responsável:</span>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">{proposal.createdBy}</h3>
              <p className="text-slate-600 mt-0.5">Status: <strong className="text-emerald-700 uppercase">{proposal.status}</strong></p>
            </div>
          </div>

          {/* Title & Summary */}
          <div className="mb-6">
            <h2 className="text-base font-bold text-slate-900">{proposal.title}</h2>
            <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">{proposal.summary}</p>
          </div>

          {/* Deliverables Table */}
          <div className="mb-6">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Escopo de Serviços & Investimento</h4>
            <table className="w-full text-left text-xs border border-slate-200">
              <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-3 border-b border-slate-200">Descrição do Item / Módulo</th>
                  <th className="py-2.5 px-3 border-b border-slate-200 text-center w-16">Qtd</th>
                  <th className="py-2.5 px-3 border-b border-slate-200 text-right w-28">Valor Unit.</th>
                  <th className="py-2.5 px-3 border-b border-slate-200 text-right w-28">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {proposal.items?.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 px-3 font-medium text-slate-800">{item.description}</td>
                    <td className="py-2.5 px-3 text-center text-slate-600 font-mono">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                      R$ {item.unitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 font-mono">
                      R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-right font-bold text-slate-800 uppercase text-xs">
                    Investimento Total do Projeto:
                  </td>
                  <td className="py-3 px-3 text-right font-black text-slate-950 font-mono text-sm">
                    R$ {proposal.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Terms */}
          <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 mb-6 text-xs">
            <span className="font-bold text-amber-950 uppercase text-[10px] block">Condições de Pagamento:</span>
            <p className="text-amber-900 font-medium mt-1">{proposal.paymentTerms}</p>
          </div>

          {/* Warranties & SLAs */}
          <div className="grid grid-cols-3 gap-4 text-[11px] text-slate-600 border-t border-slate-200 pt-4">
            <div>
              <strong className="text-slate-800 block">✓ Design Exclusivo</strong>
              Layout sob medida aprovado no Figma antes da codificação.
            </div>
            <div>
              <strong className="text-slate-800 block">✓ 100% Responsivo</strong>
              Testado e otimizado para todos os modelos de smartphone e tablets.
            </div>
            <div>
              <strong className="text-slate-800 block">✓ Suporte & Garantia</strong>
              30 dias de suporte e homologação sem custos adicionais.
            </div>
          </div>

          {/* Signature / Acceptance Simulation */}
          <div className="mt-10 pt-6 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs">
            <div>
              <div className="border-b border-slate-400 pb-1 font-bold text-slate-800">
                FAZER MEU WEBSITE LTDA
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Diretoria Comercial & Projetos</div>
            </div>
            <div>
              <div className="border-b border-slate-400 pb-1 font-bold text-slate-800">
                {proposal.clientName}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">De Acordo & Aceite de Proposta</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
