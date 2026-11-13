import React, { useState, useEffect } from 'react';
import {
  Building2,
  Search,
  Plus,
  LifeBuoy,
  MessageSquare,
  Edit,
  Trash2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { Client, ClientService, ServiceProduct } from '../types';
import { ClientServiceManager } from './ClientServiceManager';
import { calculateClientMrr } from '../utils/clientServices';

interface ClientsModuleProps {
  clients: Client[];
  catalogServices: ServiceProduct[];
  selectedClientIdExternal?: string | null;
  onOpenClientModal: (client?: Client) => void;
  onSaveClient: (clientData: Partial<Client>) => Promise<void>;
  onOpenWhatsApp: (phone: string) => void;
  onOpenSupportTicket: (client: Client) => void;
  onDeleteClient: (clientId: string) => void;
  onOpenCatalogSettings?: () => void;
}

export const ClientsModule: React.FC<ClientsModuleProps> = ({
  clients,
  catalogServices,
  selectedClientIdExternal,
  onOpenClientModal,
  onSaveClient,
  onOpenWhatsApp,
  onOpenSupportTicket,
  onDeleteClient,
  onOpenCatalogSettings
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inadimplente' | 'cancelado'>('all');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    selectedClientIdExternal || clients[0]?.id || null
  );
  const [savingServices, setSavingServices] = useState(false);
  const [serviceFeedback, setServiceFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (selectedClientIdExternal) {
      setSelectedClientId(selectedClientIdExternal);
      setServiceFeedback(null);
    }
  }, [selectedClientIdExternal]);

  const selectedClient =
    clients.find((c) => c.id === selectedClientId) || clients[0] || null;

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.tradeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cnpjCpf.includes(searchTerm) ||
      c.contactName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalMRR = clients.reduce((acc, c) => acc + (c.mrr || 0), 0);
  const activeCount = clients.filter((c) => c.status === 'ativo').length;
  const overdueCount = clients.filter((c) => c.status === 'inadimplente').length;

  const handleUpdateSelectedServices = async (nextServices: ClientService[]) => {
    if (!selectedClient) return;
    setSavingServices(true);
    setServiceFeedback(null);
    try {
      const nextMrr = calculateClientMrr(nextServices);
      await onSaveClient({
        ...selectedClient,
        id: selectedClient.id,
        services: nextServices,
        mrr: nextMrr
      });
      setServiceFeedback({
        type: 'success',
        text: `Serviços e MRR (R$ ${nextMrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês) atualizados no banco de dados.`
      });
    } catch (err: any) {
      setServiceFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível salvar os serviços do cliente.'
      });
    } finally {
      setSavingServices(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Total Clientes na Carteira</div>
          <div className="text-2xl font-black text-white font-mono tabular-nums mt-1">{clients.length}</div>
          <div className="text-[11px] text-emerald-400 mt-1">{activeCount} ativos em dia</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">MRR Recorrente (Hospedagem &amp; Suporte)</div>
          <div className="text-2xl font-black text-[#D4A72C] font-mono tabular-nums mt-1">
            R$ {totalMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Faturamento mensal fixo</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Inadimplência / Pendências</div>
          <div className="text-2xl font-black text-rose-400 font-mono tabular-nums mt-1">{overdueCount}</div>
          <div className="text-[11px] text-rose-400/80 mt-1">Cobrança automática Asaas ativa</div>
        </div>
      </div>

      {/* Filter & Action Bar */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por razão social, nome fantasia, CNPJ ou contato..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">Todos os Status</option>
            <option value="ativo">Ativos ({activeCount})</option>
            <option value="inadimplente">Inadimplentes ({overdueCount})</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => onOpenClientModal()}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus size={15} />
          <span>Novo Cliente</span>
        </button>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Clients List (5 cols) */}
        <div className="lg:col-span-5 bg-[#11141E] border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80 max-h-[calc(100vh-280px)] overflow-y-auto">
          {filteredClients.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <Building2 size={24} className="mx-auto text-slate-600 mb-1" />
              <div className="font-semibold text-slate-300">Nenhum cliente cadastrado</div>
              <p className="text-[11px] text-slate-500">
                Cadastre o primeiro cliente contratante ou converta um lead com proposta ganha no CRM.
              </p>
            </div>
          ) : (
            filteredClients.map((client) => {
              const isSelected = selectedClient?.id === client.id;
              return (
                <div
                  key={client.id}
                  onClick={() => {
                    setSelectedClientId(client.id);
                    setServiceFeedback(null);
                  }}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#151926] ring-1 ring-inset ring-[#D4A72C]/50'
                      : 'hover:bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">
                        {client.tradeName || client.companyName}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate">{client.companyName}</p>
                    </div>
                    <span
                      className={`text-[11px] font-semibold uppercase shrink-0 ${
                        client.status === 'ativo'
                          ? 'text-emerald-400'
                          : client.status === 'inadimplente'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {client.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                    <span className="truncate">
                      Contato: <strong className="text-slate-300">{client.contactName}</strong> ·{' '}
                      {(client.services || []).length} serviço(s)
                    </span>
                    <span className="font-mono tabular-nums text-[#D4A72C] font-semibold whitespace-nowrap shrink-0">
                      R$ {(client.mrr || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Client Detail (7 cols) */}
        <div className="lg:col-span-7 bg-[#11141E] border border-slate-800 rounded-xl p-5 space-y-5">
          {selectedClient ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      {selectedClient.tradeName || selectedClient.companyName}
                    </h3>
                    <span
                      className={`text-[11px] font-bold uppercase ${
                        selectedClient.status === 'ativo'
                          ? 'text-emerald-400'
                          : selectedClient.status === 'inadimplente'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      · {selectedClient.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedClient.companyName} · CNPJ/CPF: <span className="font-mono">{selectedClient.cnpjCpf || 'Não informado'}</span>
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenClientModal(selectedClient)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                    title="Editar Cliente"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteClient(selectedClient.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-colors cursor-pointer"
                    title="Excluir Cliente"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-900/60 border border-slate-800/80 text-xs">
                <div>
                  <span className="text-slate-400 text-[10px] block">Responsável</span>
                  <span className="font-semibold text-white">{selectedClient.contactName}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">E-mail</span>
                  <span className="text-slate-300 truncate block">{selectedClient.email}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">WhatsApp</span>
                  <button
                    type="button"
                    onClick={() => onOpenWhatsApp(selectedClient.whatsapp)}
                    className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <MessageSquare size={12} />
                    <span>{selectedClient.phone || selectedClient.whatsapp}</span>
                  </button>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Localização</span>
                  <span className="text-slate-300">
                    {selectedClient.city} - {selectedClient.state}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Início Contrato</span>
                  <span className="text-slate-300 font-mono tabular-nums">{selectedClient.contractStart}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Ações Rápidas</span>
                  <button
                    type="button"
                    onClick={() => onOpenSupportTicket(selectedClient)}
                    className="text-[#D4A72C] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <LifeBuoy size={12} />
                    <span>Abrir Chamado</span>
                  </button>
                </div>
              </div>

              {serviceFeedback && (
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    serviceFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {serviceFeedback.type === 'success' ? (
                    <CheckCircle2 size={14} className="shrink-0" />
                  ) : (
                    <AlertCircle size={14} className="shrink-0" />
                  )}
                  <span>{serviceFeedback.text}</span>
                </div>
              )}

              {/* Subscribed Services, Hostings & 1-Click Catalog */}
              <ClientServiceManager
                services={selectedClient.services || []}
                catalogServices={catalogServices}
                onChange={handleUpdateSelectedServices}
                saving={savingServices}
                onOpenCatalogSettings={onOpenCatalogSettings}
              />

              {/* Notes */}
              {selectedClient.notes && (
                <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-300">
                  <span className="text-slate-400 font-semibold block mb-0.5">Observações Comerciais:</span>
                  <p>{selectedClient.notes}</p>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-xs text-slate-400">
              Selecione um cliente ao lado para ver os detalhes completos
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
