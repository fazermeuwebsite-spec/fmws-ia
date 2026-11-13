import React, { useState } from 'react';
import { X, Building2, AlertCircle } from 'lucide-react';
import { Client, ClientService, ServiceProduct } from '../../types';
import { ClientServiceManager } from '../ClientServiceManager';
import { calculateClientMrr } from '../../utils/clientServices';

interface ClientModalProps {
  client?: Client | null;
  catalogServices: ServiceProduct[];
  onOpenCatalogSettings?: () => void;
  onClose: () => void;
  onSave: (clientData: Partial<Client>) => Promise<void> | void;
}

export const ClientModal: React.FC<ClientModalProps> = ({
  client,
  catalogServices,
  onOpenCatalogSettings,
  onClose,
  onSave
}) => {
  const [companyName, setCompanyName] = useState(client?.companyName || '');
  const [tradeName, setTradeName] = useState(client?.tradeName || '');
  const [cnpjCpf, setCnpjCpf] = useState(client?.cnpjCpf || '');
  const [contactName, setContactName] = useState(client?.contactName || '');
  const [email, setEmail] = useState(client?.email || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [whatsapp, setWhatsapp] = useState(client?.whatsapp || '');
  const [city, setCity] = useState(client?.city || 'São Paulo');
  const [state, setState] = useState(client?.state || 'SP');
  const [address, setAddress] = useState(client?.address || '');
  const [status, setStatus] = useState<Client['status']>(client?.status || 'ativo');
  const [notes, setNotes] = useState(client?.notes || '');
  const [clientServices, setClientServices] = useState<ClientService[]>(() =>
    Array.isArray(client?.services) ? client.services.map((s) => ({ ...s })) : []
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedMrr = calculateClientMrr(clientServices);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: Partial<Client> = {
        ...(client ? { id: client.id } : {}),
        companyName: companyName.trim(),
        tradeName: (tradeName || companyName).trim(),
        cnpjCpf: cnpjCpf.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        whatsapp: (whatsapp || phone).replace(/\D/g, ''),
        city: city.trim(),
        state: state.trim(),
        address: address.trim(),
        status,
        contractStart: client?.contractStart || new Date().toISOString().substring(0, 10),
        mrr: computedMrr,
        notes: notes.trim(),
        services: clientServices
      };
      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar cliente no banco de dados.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6 max-h-[92vh] flex flex-col">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <Building2 size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {client ? `Editar Cliente: ${client.tradeName || client.companyName}` : 'Cadastrar Novo Cliente'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Dados contratuais, serviços contratados e cálculo automático de MRR
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Razão Social *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex: Alfa Negócios Digitais Ltda"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Nome Fantasia</label>
              <input
                type="text"
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Ex: Alfa Soluções"
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">CNPJ ou CPF *</label>
              <input
                type="text"
                value={cnpjCpf}
                onChange={(e) => setCnpjCpf(e.target.value)}
                placeholder="12.345.678/0001-90"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Pessoa de Contato *</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nome do responsável"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">E-mail Principal *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="financeiro@empresa.com"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">WhatsApp de Cobrança *</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="5511987654321"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
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
              <label className="block text-slate-300 font-semibold mb-1">UF</label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="SP"
                maxLength={2}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white uppercase font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Status Contratual</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="ativo">Ativo (Em Dia)</option>
                <option value="inadimplente">Inadimplente (Bloquear Servidor)</option>
                <option value="cancelado">Cancelado / Encerrado</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                MRR Mensal Calculado (R$)
              </label>
              <div className="w-full bg-[#090B10]/70 border border-slate-800 rounded-lg p-2 text-[#D4A72C] font-mono tabular-nums font-bold">
                R$ {computedMrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Soma automática dos serviços ativos abaixo
              </p>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Endereço Comercial</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rua, número, bairro, cidade - UF"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          {/* Contracted Services & Hostings Management */}
          <div className="pt-3 border-t border-slate-800">
            <ClientServiceManager
              compact
              services={clientServices}
              catalogServices={catalogServices}
              onChange={setClientServices}
              saving={saving}
              onOpenCatalogSettings={
                onOpenCatalogSettings
                  ? () => {
                      onClose();
                      onOpenCatalogSettings();
                    }
                  : undefined
              }
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Observações Internas</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anotações comerciais, acessos ou preferências..."
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
