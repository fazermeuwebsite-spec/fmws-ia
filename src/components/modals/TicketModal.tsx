import React, { useState } from 'react';
import { X, LifeBuoy } from 'lucide-react';
import { SupportTicket, Client } from '../../types';

interface TicketModalProps {
  initialClient?: Client | null;
  currentUserName: string;
  onClose: () => void;
  onSave: (ticket: Partial<SupportTicket>) => void;
}

export const TicketModal: React.FC<TicketModalProps> = ({
  initialClient,
  currentUserName,
  onClose,
  onSave
}) => {
  const [clientName, setClientName] = useState(initialClient?.tradeName || '');
  const [contactPhone, setContactPhone] = useState(initialClient?.whatsapp || '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<SupportTicket['priority']>('media');
  const [channel, setChannel] = useState<SupportTicket['channel']>('whatsapp');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      clientId: initialClient?.id,
      clientName,
      contactPhone,
      subject,
      description,
      priority,
      channel,
      status: 'aberto',
      assignedTo: currentUserName,
      notes: [
        {
          author: currentUserName,
          text: 'Chamado aberto formalmente no sistema.',
          createdAt: new Date().toISOString()
        }
      ]
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <LifeBuoy size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Abrir Novo Chamado de Suporte</h3>
              <p className="text-[11px] text-slate-400">Atendimento técnico e controle de SLA</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Cliente / Empresa</label>
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
              <label className="block text-slate-300 font-semibold mb-1">WhatsApp de Contato</label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="5511987654321"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Prioridade SLA</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="baixa">Baixa (Até 48 horas)</option>
                <option value="media">Média (Até 24 horas)</option>
                <option value="alta">Alta (Até 4 horas)</option>
                <option value="critica">Crítica - Site Fora do Ar (Até 1 hora)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Canal de Origem</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="whatsapp">WhatsApp Oficial</option>
                <option value="email">E-mail</option>
                <option value="painel">Painel Interno</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Assunto do Chamado</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex: Erro no formulário de contato / Atualizar banner da home"
              required
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Descrição Detalhada do Problema</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explique o que o cliente solicitou ou o comportamento observado..."
              required
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
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
              Registrar Chamado
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
