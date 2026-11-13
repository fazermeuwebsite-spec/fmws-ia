import React, { useState } from 'react';
import { X, FileText, Plus, Trash2, DollarSign } from 'lucide-react';
import { Proposal, ProposalItem, Lead } from '../../types';

interface ProposalModalProps {
  initialLead?: Lead | null;
  currentUserName: string;
  onClose: () => void;
  onSave: (proposal: Partial<Proposal>) => void;
}

export const ProposalModal: React.FC<ProposalModalProps> = ({
  initialLead,
  currentUserName,
  onClose,
  onSave
}) => {
  const [clientName, setClientName] = useState(initialLead?.company || '');
  const [title, setTitle] = useState(
    initialLead
      ? `Desenvolvimento de Website Institucional para ${initialLead.company}`
      : 'Proposta Comercial'
  );
  const [summary, setSummary] = useState('');
  const [deliveryDays, setDeliveryDays] = useState(14);
  const [validUntil, setValidUntil] = useState(
    new Date(Date.now() + 15 * 86400000).toISOString().substring(0, 10)
  );
  const [paymentTerms, setPaymentTerms] = useState('A combinar');
  const [items, setItems] = useState<ProposalItem[]>([
    {
      id: 'item_1',
      description: 'Desenvolvimento de Website Institucional',
      quantity: 1,
      unitPrice: initialLead?.value || 0,
      total: initialLead?.value || 0
    }
  ]);

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        id: `item_${Date.now()}`,
        description: '',
        quantity: 1,
        unitPrice: 0,
        total: 0
      }
    ]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(i => i.id !== id));
  };

  const handleUpdateItem = (id: string, field: keyof ProposalItem, val: any) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: val };
        if (field === 'quantity' || field === 'unitPrice') {
          updated.total = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      }
      return item;
    }));
  };

  const totalValue = items.reduce((acc, i) => acc + (i.total || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      clientName,
      leadId: initialLead?.id,
      title,
      summary,
      items,
      totalValue,
      paymentTerms,
      deliveryDays,
      validUntil,
      status: 'aguardando_aprovacao',
      createdBy: currentUserName
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <FileText size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Criar Nova Proposta Comercial</h3>
              <p className="text-[11px] text-slate-400">Elaboração de orçamento oficial para aprovação e envio</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Cliente / Empresa</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Clínica Odonto Caldas"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Prazo de Entrega (dias úteis)</label>
              <input
                type="number"
                value={deliveryDays}
                onChange={(e) => setDeliveryDays(parseInt(e.target.value, 10))}
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Título da Proposta</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Resumo Executivo do Escopo</label>
            <textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-[11px] uppercase tracking-wider">Itens e Serviços Orçados</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[#D4A72C] text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus size={12} />
                <span>Adicionar Item</span>
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 bg-[#090B10] p-2 rounded-lg border border-slate-800">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleUpdateItem(item.id, 'description', e.target.value)}
                    placeholder="Descrição do serviço..."
                    className="flex-1 bg-transparent text-white focus:outline-none"
                    required
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => handleUpdateItem(item.id, 'quantity', parseInt(e.target.value, 10))}
                    className="w-14 bg-slate-900 border border-slate-700 rounded p-1 text-center text-white font-mono"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => handleUpdateItem(item.id, 'unitPrice', parseFloat(e.target.value))}
                    className="w-24 bg-slate-900 border border-slate-700 rounded p-1 text-right text-white font-mono"
                  />
                  <span className="w-24 text-right font-bold text-[#D4A72C] font-mono">
                    R$ {item.total?.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end p-2 bg-slate-900/60 rounded-lg border border-slate-800">
              <span className="text-xs text-slate-300 font-bold uppercase mr-3">Valor Total:</span>
              <span className="text-sm font-black text-[#D4A72C] font-mono">
                R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Condições de Pagamento</label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Válido Até</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>
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
              Salvar Proposta Comercial
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
