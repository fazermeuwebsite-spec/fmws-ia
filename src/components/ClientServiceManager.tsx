import React, { useState } from 'react';
import {
  Plus,
  Server,
  Globe,
  FileCheck,
  Edit3,
  Trash2,
  Zap,
  ShieldCheck,
  ShoppingBag,
  Settings,
  X,
  Check
} from 'lucide-react';
import { ClientService, ServiceProduct } from '../types';
import {
  CLIENT_SERVICE_STATUS_LABEL,
  CLIENT_SERVICE_TYPE_LABEL,
  calculateClientMrr,
  createClientServiceFromCatalog,
  formatCatalogServicePriceLabel,
  getDefaultExpiryDate
} from '../utils/clientServices';

interface ClientServiceManagerProps {
  services: ClientService[];
  catalogServices: ServiceProduct[];
  onChange: (nextServices: ClientService[]) => Promise<void> | void;
  saving?: boolean;
  onOpenCatalogSettings?: () => void;
  compact?: boolean;
}

const SERVICE_TYPE_OPTIONS: Array<{ value: ClientService['type']; label: string }> = [
  { value: 'hospedagem', label: 'Hospedagem' },
  { value: 'website', label: 'Website' },
  { value: 'manutencao', label: 'Manutenção & Suporte' },
  { value: 'dominio', label: 'Domínio / SSL' },
  { value: 'ecommerce', label: 'E-commerce' }
];

const SERVICE_STATUS_OPTIONS: Array<{ value: ClientService['status']; label: string }> = [
  { value: 'ativo', label: 'Ativo' },
  { value: 'renovacao', label: 'Em renovação' },
  { value: 'suspenso', label: 'Suspenso' }
];

const STATUS_STYLE: Record<ClientService['status'], string> = {
  ativo: 'text-emerald-300',
  renovacao: 'text-amber-300',
  suspenso: 'text-rose-300'
};

function renderTypeIcon(type: ClientService['type']) {
  if (type === 'hospedagem') return <Server size={15} />;
  if (type === 'dominio') return <Globe size={15} />;
  if (type === 'manutencao') return <ShieldCheck size={15} />;
  if (type === 'ecommerce') return <ShoppingBag size={15} />;
  return <FileCheck size={15} />;
}

export const ClientServiceManager: React.FC<ClientServiceManagerProps> = ({
  services,
  catalogServices,
  onChange,
  saving = false,
  onOpenCatalogSettings,
  compact = false
}) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<ClientService['type']>('hospedagem');
  const [domain, setDomain] = useState('');
  const [hostingServer, setHostingServer] = useState('');
  const [expiryDate, setExpiryDate] = useState(getDefaultExpiryDate(12));
  const [monthlyValue, setMonthlyValue] = useState('');
  const [status, setStatus] = useState<ClientService['status']>('ativo');

  const computedMrr = calculateClientMrr(services);

  const resetForm = () => {
    setEditorOpen(false);
    setEditingId(null);
    setFormError(null);
    setName('');
    setType('hospedagem');
    setDomain('');
    setHostingServer('');
    setExpiryDate(getDefaultExpiryDate(12));
    setMonthlyValue('');
    setStatus('ativo');
  };

  const openNewForm = () => {
    setEditingId(null);
    setFormError(null);
    setName('');
    setType('hospedagem');
    setDomain('');
    setHostingServer('');
    setExpiryDate(getDefaultExpiryDate(12));
    setMonthlyValue('');
    setStatus('ativo');
    setEditorOpen(true);
  };

  const openEditForm = (svc: ClientService) => {
    setEditingId(svc.id);
    setFormError(null);
    setName(svc.name || '');
    setType(svc.type || 'website');
    setDomain(svc.domain || '');
    setHostingServer(svc.hostingServer || '');
    setExpiryDate(svc.expiryDate || getDefaultExpiryDate(12));
    setMonthlyValue(
      typeof svc.monthlyValue === 'number' && !isNaN(svc.monthlyValue)
        ? String(svc.monthlyValue)
        : '0'
    );
    setStatus(svc.status || 'ativo');
    setEditorOpen(true);
  };

  const handleQuickAddFromCatalog = async (product: ServiceProduct) => {
    if (saving) return;
    const item = createClientServiceFromCatalog(product);
    await onChange([...services, item]);
  };

  const handleRemoveService = async (serviceId: string) => {
    if (saving) return;
    if (editingId === serviceId) {
      resetForm();
    }
    await onChange(services.filter((s) => s.id !== serviceId));
  };

  const handleSaveEditor = async () => {
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Informe o nome do serviço ou plano de hospedagem.');
      return;
    }
    const parsedValue = parseFloat(monthlyValue.replace(',', '.'));
    const safeMonthlyValue =
      Number.isFinite(parsedValue) && parsedValue >= 0
        ? Math.round(parsedValue * 100) / 100
        : 0;

    setFormError(null);

    if (editingId) {
      const next = services.map((s) =>
        s.id === editingId
          ? {
              ...s,
              name: trimmedName,
              type,
              domain: domain.trim(),
              hostingServer: hostingServer.trim(),
              expiryDate: expiryDate || getDefaultExpiryDate(12),
              monthlyValue: safeMonthlyValue,
              status
            }
          : s
      );
      await onChange(next);
    } else {
      const created: ClientService = {
        id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        type,
        domain: domain.trim(),
        hostingServer: hostingServer.trim(),
        expiryDate: expiryDate || getDefaultExpiryDate(12),
        monthlyValue: safeMonthlyValue,
        status
      };
      await onChange([...services, created]);
    }
    resetForm();
  };

  return (
    <div className="space-y-3">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-[#D4A72C]" />
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
            Serviços Contratados &amp; Hospedagens ({services.length})
          </h4>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums font-bold text-[#D4A72C]">
            MRR: R$ {computedMrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
          </span>
          <button
            type="button"
            onClick={openNewForm}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-[#D4A72C]/15 border border-[#D4A72C]/40 text-[#D4A72C] hover:bg-[#D4A72C] hover:text-slate-950 text-[11px] font-bold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Plus size={13} />
            <span>Novo Serviço / Host</span>
          </button>
        </div>
      </div>

      {/* 1-Click Quick Add from Settings Catalog */}
      <div className="p-3 rounded-xl bg-[#090B10]/80 border border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <Zap size={12} className="text-[#D4A72C]" />
            <span>Adicionar em 1 Clique · Tabela de Serviços &amp; Preços</span>
          </div>
          {onOpenCatalogSettings && (
            <button
              type="button"
              onClick={onOpenCatalogSettings}
              className="text-[11px] text-slate-400 hover:text-[#D4A72C] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings size={11} />
              <span>Gerenciar Catálogo</span>
            </button>
          )}
        </div>

        {catalogServices.length === 0 ? (
          <div className="text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 py-1">
            <span>Nenhum plano cadastrado em Configurações &gt; Tabela de Serviços &amp; Preços.</span>
            {onOpenCatalogSettings && (
              <button
                type="button"
                onClick={onOpenCatalogSettings}
                className="text-[#D4A72C] hover:underline font-semibold cursor-pointer"
              >
                Cadastrar planos agora
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {catalogServices.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={saving}
                onClick={() => handleQuickAddFromCatalog(product)}
                title={product.description || `Adicionar ${product.name}`}
                className="px-2.5 py-1.5 rounded-lg bg-[#151926] hover:bg-[#D4A72C]/15 border border-slate-700/80 hover:border-[#D4A72C]/50 text-left transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Plus size={12} className="text-[#D4A72C] shrink-0" />
                <span className="text-[11px] font-semibold text-slate-100 truncate max-w-[180px]">
                  {product.name}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-[#D4A72C] whitespace-nowrap shrink-0">
                  {formatCatalogServicePriceLabel(product)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Inline Service / Hosting Add & Edit Panel (uses div, never nested form) */}
      {editorOpen && (
        <div className="p-3.5 rounded-xl bg-[#090B10] border border-[#D4A72C]/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">
              {editingId ? 'Editar Serviço / Hospedagem' : 'Adicionar Serviço / Hospedagem Manual'}
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
              title="Fechar editor"
            >
              <X size={14} />
            </button>
          </div>

          {formError && (
            <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
              {formError}
            </div>
          )}

          <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-2.5 text-xs`}>
            <div className={compact ? 'sm:col-span-2' : 'sm:col-span-2'}>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                Nome do Serviço ou Plano *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Hospedagem Cloud NVMe, Site Institucional..."
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">Categoria / Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ClientService['type'])}
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
              >
                {SERVICE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                Valor Mensal MRR (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyValue}
                onChange={(e) => setMonthlyValue(e.target.value)}
                placeholder="0.00"
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[#D4A72C] font-mono tabular-nums font-semibold text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">Vencimento / Renovação</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ClientService['status'])}
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
              >
                {SERVICE_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">Domínio (opcional)</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: empresa.com.br"
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
              />
            </div>

            <div className={compact ? '' : 'sm:col-span-2'}>
              <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                Servidor / Host (opcional)
              </label>
              <input
                type="text"
                value={hostingServer}
                onChange={(e) => setHostingServer(e.target.value)}
                placeholder="ex: vps-br01.host ou cloudflare"
                className="w-full bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveEditor}
              className="px-3.5 py-1.5 rounded-lg bg-[#D4A72C] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Check size={13} />
              <span>{saving ? 'Salvando...' : editingId ? 'Atualizar Item' : 'Adicionar Item'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Services & Hosting List */}
      {services.length === 0 ? (
        <div className="p-5 rounded-xl bg-[#090B10]/50 border border-dashed border-slate-800 text-center space-y-1">
          <div className="text-xs font-semibold text-slate-300">
            Nenhum serviço ou hospedagem vinculado a este cliente
          </div>
          <p className="text-[11px] text-slate-500">
            Use os atalhos de 1 clique acima ou clique em &ldquo;Novo Serviço / Host&rdquo; para adicionar itens reais.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => (
            <div
              key={svc.id}
              className="p-3 rounded-lg bg-[#151926] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-slate-800/90 text-[#D4A72C] flex items-center justify-center shrink-0">
                  {renderTypeIcon(svc.type)}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{svc.name}</div>
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <span>{CLIENT_SERVICE_TYPE_LABEL[svc.type] || svc.type}</span>
                    {svc.domain && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-400 font-mono truncate">{svc.domain}</span>
                      </>
                    )}
                    {svc.hostingServer && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono truncate">{svc.hostingServer}</span>
                      </>
                    )}
                    {svc.expiryDate && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">Vence {svc.expiryDate}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <div className="text-left sm:text-right">
                  <div className="text-xs font-mono tabular-nums font-bold text-white">
                    {svc.monthlyValue > 0
                      ? `R$ ${svc.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês`
                      : 'Sem recorrência'}
                  </div>
                  <div className={`text-[11px] font-semibold ${STATUS_STYLE[svc.status] || 'text-slate-400'}`}>
                    {CLIENT_SERVICE_STATUS_LABEL[svc.status] || svc.status}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => openEditForm(svc)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                    title="Editar serviço / hospedagem"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleRemoveService(svc.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                    title="Remover serviço / hospedagem"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
