import React, { useState } from 'react';
import { X, DollarSign, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { FinancialTransaction } from '../../types';

interface TransactionModalProps {
  onClose: () => void;
  onSave: (tx: Partial<FinancialTransaction>) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({ onClose, onSave }) => {
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [type, setType] = useState<'receita' | 'despesa'>('receita');
  const [category, setCategory] = useState<FinancialTransaction['category']>('desenvolvimento');
  const [value, setValue] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().substring(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'boleto' | 'cartao'>('pix');
  const [recurring, setRecurring] = useState(false);
  const [status, setStatus] = useState<'pago' | 'pendente'>('pendente');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      description,
      clientName: clientName || (type === 'receita' ? 'Cliente Direto' : 'Fornecedor'),
      type,
      category,
      value: parseFloat(value) || 0,
      dueDate,
      paymentMethod,
      recurring,
      status,
      paymentDate: status === 'pago' ? new Date().toISOString().substring(0, 10) : undefined
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <DollarSign size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Novo Lançamento Financeiro</h3>
              <p className="text-[11px] text-slate-400">Contas a pagar, receber e conciliação Asaas</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {/* Type Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-[#090B10] rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setType('receita'); setCategory('desenvolvimento'); }}
              className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
                type === 'receita' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDownLeft size={14} />
              <span>Receita (+)</span>
            </button>
            <button
              type="button"
              onClick={() => { setType('despesa'); setCategory('infraestrutura'); }}
              className={`py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all ${
                type === 'despesa' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight size={14} />
              <span>Despesa (-)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Descrição</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Mensalidade Hospedagem Cloud"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                {type === 'receita' ? 'Cliente' : 'Fornecedor / Beneficiário'}
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Lumina Arquitetura"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Categoria Contábil</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white capitalize"
              >
                {type === 'receita' ? (
                  <>
                    <option value="desenvolvimento">Desenvolvimento de Sites</option>
                    <option value="hospedagem">Hospedagem Cloud SSD</option>
                    <option value="manutencao">Manutenção & Suporte VIP</option>
                  </>
                ) : (
                  <>
                    <option value="infraestrutura">Servidores & Datacenter</option>
                    <option value="marketing">Marketing & Anúncios</option>
                    <option value="impostos">Impostos & Taxas</option>
                    <option value="salarios">Comissões & Equipe</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0,00"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-[#D4A72C] font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Data de Vencimento</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Forma de Pagamento</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="pix">PIX Instantâneo</option>
                <option value="boleto">Boleto Bancário (Asaas)</option>
                <option value="cartao">Cartão de Crédito</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="rounded text-[#D4A72C]"
              />
              <span className="text-slate-300 font-semibold">Lançamento Recorrente Mensal (MRR)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={status === 'pago'}
                onChange={(e) => setStatus(e.target.checked ? 'pago' : 'pendente')}
                className="rounded text-emerald-500"
              />
              <span className="text-emerald-400 font-semibold">Já Pago / Compensado</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
            >
              Registrar Lançamento
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
