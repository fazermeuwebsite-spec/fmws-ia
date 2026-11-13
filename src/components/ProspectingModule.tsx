import React, { useState } from 'react';
import {
  Radar,
  Search,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Sparkles,
  Download,
  Upload,
  Plus,
  Trash2,
  Globe,
  RefreshCw,
  FileSpreadsheet,
  Lock,
  ExternalLink
} from 'lucide-react';
import { api } from '../services/api';
import { Lead, ProspectCompany, SystemIntegrations } from '../types';

interface ProspectingModuleProps {
  prospects: ProspectCompany[];
  integrations: SystemIntegrations;
  existingLeads: Lead[];
  currentUserName: string;
  onProspectsChange: (updater: (prev: ProspectCompany[]) => ProspectCompany[]) => void;
  onImportLeadToCrm: (leadData: Partial<Lead>) => Promise<void> | void;
  onOpenSettings?: () => void;
}

function parseCsvRows(rawText: string): Record<string, string>[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  };

  const headers = splitLine(firstLine).map((h) =>
    h
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );

  const mappedRows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.every((c) => !c)) continue;
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const val = cols[idx] || '';
      if (h.includes('empresa') || h === 'company' || h === 'razao_social' || h === 'nome_fantasia') {
        rowObj.company = val;
      } else if (h === 'name' || h === 'contato' || h === 'responsavel' || h === 'decisor') {
        rowObj.name = val;
      } else if (h === 'phone' || h === 'telefone' || h === 'fone') {
        rowObj.phone = val;
      } else if (h === 'whatsapp' || h === 'zap' || h === 'celular') {
        rowObj.whatsapp = val;
      } else if (h === 'email' || h === 'e_mail') {
        rowObj.email = val;
      } else if (h === 'segment' || h === 'segmento' || h === 'nicho' || h === 'categoria') {
        rowObj.segment = val;
      } else if (h === 'city' || h === 'cidade' || h === 'municipio') {
        rowObj.city = val;
      } else if (h === 'state' || h === 'uf' || h === 'estado') {
        rowObj.state = val;
      } else if (h === 'address' || h === 'endereco') {
        rowObj.address = val;
      } else if (h === 'website' || h === 'websiteurl' || h === 'site' || h === 'url' || h === 'dominio') {
        rowObj.websiteUrl = val;
      }
    });
    if (rowObj.company) {
      mappedRows.push(rowObj);
    }
  }
  return mappedRows;
}

export const ProspectingModule: React.FC<ProspectingModuleProps> = ({
  prospects,
  integrations,
  existingLeads,
  currentUserName,
  onProspectsChange,
  onImportLeadToCrm,
  onOpenSettings
}) => {
  const [entryMode, setEntryMode] = useState<'manual' | 'csv' | 'places'>('manual');

  // Manual form state
  const [company, setCompany] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [segment, setSegment] = useState('Odontologia');
  const [city, setCity] = useState('');
  const [state, setState] = useState('SP');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  // CSV state
  const [csvText, setCsvText] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);

  // Places state (kept strictly disabled until configured)
  const [placesState, setPlacesState] = useState('SP');
  const [placesCity, setPlacesCity] = useState('São Paulo');
  const [placesSegment, setPlacesSegment] = useState('Odontologia');
  const [placesRadius, setPlacesRadius] = useState(10);
  const [placesLoading, setPlacesLoading] = useState(false);

  // List filters
  const [searchFilter, setSearchFilter] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [websiteFilter, setWebsiteFilter] = useState<'all' | 'sem_site' | 'com_site'>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | 'auditado' | 'pendente'>('all');

  const [auditingId, setAuditingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const isPlacesReady = Boolean(
    integrations?.googlePlaces?.enabled &&
      integrations?.googlePlaces?.hasApiKey &&
      integrations?.googlePlaces?.status === 'conectado'
  );

  const isDuplicateInCrm = (p: ProspectCompany) => {
    const normName = p.company.toLowerCase().trim();
    const cleanPhone = (p.whatsapp || p.phone || '').replace(/\D/g, '');
    return existingLeads.some(
      (l) =>
        l.company.toLowerCase().trim() === normName ||
        (cleanPhone && (l.whatsapp || l.phone || '').replace(/\D/g, '') === cleanPhone)
    );
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingManual(true);
    try {
      const created = await api.createProspect({
        company: company.trim(),
        name: contactName.trim() || 'Contato Comercial',
        phone: phone.trim(),
        whatsapp: whatsapp.trim() || phone.replace(/\D/g, ''),
        email: email.trim(),
        segment,
        city: city.trim(),
        state,
        websiteUrl: websiteUrl.trim()
      });
      onProspectsChange((prev) => [created, ...prev]);
      setCompany('');
      setContactName('');
      setPhone('');
      setWhatsapp('');
      setEmail('');
      setCity('');
      setWebsiteUrl('');
      setFeedback({ type: 'success', text: `Empresa "${created.company}" cadastrada na lista de prospecção.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao cadastrar empresa.' });
    } finally {
      setSavingManual(false);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImportCsv = async () => {
    setFeedback(null);
    const parsed = parseCsvRows(csvText);
    if (parsed.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Nenhuma linha válida encontrada. Certifique-se de incluir cabeçalho (ex: empresa,contato,telefone,cidade,uf,segmento,site).'
      });
      return;
    }
    setImportingCsv(true);
    try {
      const res = await api.importProspectsCsv(parsed);
      onProspectsChange((prev) => [...(res.prospects || []), ...prev]);
      setCsvText('');
      setFeedback({
        type: 'success',
        text: `Importação CSV concluída: ${res.imported} nova(s) empresa(s) adicionada(s), ${res.duplicates} duplicata(s) ignorada(s).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao importar CSV.' });
    } finally {
      setImportingCsv(false);
    }
  };

  const handlePlacesSearch = async () => {
    setFeedback(null);
    if (!isPlacesReady) {
      setFeedback({
        type: 'warning',
        text: 'Google Places está desativado até que uma API Key autorizada seja configurada em Configurações.'
      });
      return;
    }
    setPlacesLoading(true);
    try {
      const data = await api.searchProspects({
        state: placesState,
        city: placesCity,
        segment: placesSegment,
        radius: placesRadius
      });
      if (data.results?.length) {
        onProspectsChange((prev) => [...data.results, ...prev]);
      }
      setFeedback({
        type: 'success',
        text: `Google Places API (New) retornou ${data.totalFound} empresa(s): ${data.imported || 0} importada(s), ${data.duplicates || 0} duplicada(s).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha na consulta ao Google Places API (New).' });
    } finally {
      setPlacesLoading(false);
    }
  };

  const handleAuditProspect = async (prospect: ProspectCompany) => {
    setFeedback(null);
    setAuditingId(prospect.id);
    try {
      const res = await api.auditProspect(prospect.id, prospect.websiteUrl);
      onProspectsChange((prev) =>
        prev.map((item) => (item.id === prospect.id ? res.prospect : item))
      );
      setFeedback({
        type: res.warning ? 'warning' : 'success',
        text: res.warning
          ? `Auditoria HTTP concluída para "${prospect.company}". ${res.warning}`
          : `Auditoria técnica real concluída para "${prospect.company}"!`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao auditar site.' });
    } finally {
      setAuditingId(null);
    }
  };

  const handleDeleteProspect = async (id: string) => {
    setFeedback(null);
    try {
      await api.deleteProspect(id);
      onProspectsChange((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao excluir empresa.' });
    }
  };

  const handleSendToCrm = async (prospect: ProspectCompany) => {
    if (isDuplicateInCrm(prospect)) {
      setFeedback({
        type: 'warning',
        text: `"${prospect.company}" já está cadastrada no CRM (deduplicação ativa).`
      });
      return;
    }

    setImportingId(prospect.id);
    setFeedback(null);
    try {
      await onImportLeadToCrm({
        name: prospect.name || 'Contato Comercial',
        company: prospect.company,
        email: prospect.email,
        phone: prospect.phone,
        whatsapp: prospect.whatsapp || prospect.phone.replace(/\D/g, ''),
        segment: prospect.segment || 'Geral',
        city: prospect.city,
        state: prospect.state,
        address: prospect.address,
        websiteUrl: prospect.websiteUrl,
        technicalAudit: prospect.technicalAudit,
        source: prospect.source === 'csv' ? 'csv' : 'prospeccao',
        status: 'novo',
        priority: prospect.technicalAudit?.hasWebsite ? 'media' : 'alta',
        value: 0,
        tags: [
          prospect.source === 'csv' ? 'CSV' : 'Prospecção',
          prospect.technicalAudit?.hasWebsite ? 'Com Site' : 'Sem Site'
        ],
        assignedTo: currentUserName,
        campaignStatus: 'pendente_aprovacao',
        aiInsights: prospect.aiInsights,
        notes: prospect.pitchDraft
          ? [
              {
                id: `note_${Date.now()}`,
                author: currentUserName,
                text: `Importado da Prospecção. Sugestão de abordagem (aguardando aprovação humana): ${prospect.pitchDraft}`,
                createdAt: new Date().toISOString()
              }
            ]
          : []
      });

      setFeedback({
        type: 'success',
        text: `"${prospect.company}" enviada para o CRM (aguardando aprovação humana para contato).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao enviar lead para o CRM.' });
    } finally {
      setImportingId(null);
    }
  };

  const segmentsList = Array.from(new Set(prospects.map((p) => p.segment).filter(Boolean)));

  const filteredProspects = prospects.filter((p) => {
    const q = searchFilter.toLowerCase();
    const matchesSearch =
      !q ||
      p.company.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.websiteUrl.toLowerCase().includes(q) ||
      p.phone.includes(searchFilter);

    const matchesSegment = segmentFilter === 'all' || p.segment === segmentFilter;
    const hasSite = Boolean(p.technicalAudit?.hasWebsite || p.websiteUrl);
    const matchesWebsite =
      websiteFilter === 'all' ||
      (websiteFilter === 'sem_site' && !hasSite) ||
      (websiteFilter === 'com_site' && hasSite);

    const wasAudited = Boolean(p.technicalAudit?.checkedAt);
    const matchesAudit =
      auditFilter === 'all' ||
      (auditFilter === 'auditado' && wasAudited) ||
      (auditFilter === 'pendente' && !wasAudited);

    return matchesSearch && matchesSegment && matchesWebsite && matchesAudit;
  });

  return (
    <div className="space-y-5">
      {/* Header & Mode Switcher */}
      <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Radar size={18} className="text-[#D4A72C]" />
                <span>Prospecção de Empresas, Deduplicação & Auditoria Técnica</span>
              </h2>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  isPlacesReady
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                Google Places: {isPlacesReady ? 'Conectado' : 'Desativado (Não configurado)'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Cadastre empresas manualmente ou importe listas CSV, execute verificação HTTP real de sites e envie oportunidades deduplicadas ao CRM com aprovação humana obrigatória.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-[#151926] border border-slate-800 p-1 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setEntryMode('manual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                entryMode === 'manual'
                  ? 'bg-[#D4A72C] text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Plus size={13} />
              <span>Cadastro Manual</span>
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('csv')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                entryMode === 'csv'
                  ? 'bg-[#D4A72C] text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <FileSpreadsheet size={13} />
              <span>Importar CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('places')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                entryMode === 'places'
                  ? 'bg-[#D4A72C] text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Radar size={13} />
              <span>Google Places</span>
            </button>
          </div>
        </div>

        {/* MODE 1: MANUAL FORM */}
        {entryMode === 'manual' && (
          <form onSubmit={handleCreateManual} className="pt-3 border-t border-slate-800 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Empresa *</label>
                <input
                  type="text"
                  required
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Ex: Clínica Odonto Paulista"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Contato / Decisor</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Ex: Dra. Camila"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Website (deixe vazio se não houver)</label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://empresa.com.br"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Segmento</label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="Odontologia">Odontologia</option>
                  <option value="Advocacia">Advocacia</option>
                  <option value="Saúde / Clínicas">Saúde / Clínicas</option>
                  <option value="Gastronomia">Gastronomia</option>
                  <option value="Engenharia">Engenharia & Arquitetura</option>
                  <option value="Comércio Geral">Comércio & Serviços</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex: Campinas"
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Estado (UF)</label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="SP">SP</option>
                  <option value="RJ">RJ</option>
                  <option value="MG">MG</option>
                  <option value="PR">PR</option>
                  <option value="RS">RS</option>
                  <option value="SC">SC</option>
                  <option value="BA">BA</option>
                  <option value="DF">DF</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingManual || !company.trim()}
                  className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus size={14} />
                  <span>{savingManual ? 'Salvando...' : 'Cadastrar Empresa'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* MODE 2: CSV IMPORT */}
        {entryMode === 'csv' && (
          <div className="pt-3 border-t border-slate-800 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-slate-300">
                Envie um arquivo <code className="text-[#D4A72C]">.csv</code> ou cole os dados com cabeçalho:
                <code className="ml-1 text-slate-400">empresa,contato,telefone,email,segmento,cidade,uf,site</code>
              </p>
              <label className="px-3 py-1.5 rounded-lg bg-[#151926] border border-slate-700 hover:border-[#D4A72C] text-slate-200 font-semibold cursor-pointer inline-flex items-center gap-1.5 shrink-0">
                <Upload size={13} className="text-[#D4A72C]" />
                <span>Selecionar Arquivo .CSV</span>
                <input type="file" accept=".csv,text/csv" onChange={handleCsvFileUpload} className="hidden" />
              </label>
            </div>

            <textarea
              rows={4}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={'empresa;contato;telefone;segmento;cidade;uf;site\nClínica Exemplo;Dr. João;11988887777;Odontologia;São Paulo;SP;\nEscritório Silva;Dra. Ana;11977776666;Advocacia;Campinas;SP;https://escritoriosilva.com.br'}
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-3 text-white font-mono text-[11px] focus:outline-none focus:border-[#D4A72C]"
            />

            <div className="flex items-center justify-between">
              <span className="text-slate-400">
                Linhas detectadas: <strong className="text-white">{parseCsvRows(csvText).length}</strong>
              </span>
              <button
                type="button"
                onClick={handleImportCsv}
                disabled={importingCsv || parseCsvRows(csvText).length === 0}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet size={14} />
                <span>{importingCsv ? 'Importando...' : 'Importar Lista CSV (com Deduplicação)'}</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE 3: GOOGLE PLACES (DISABLED UNTIL CONFIGURED) */}
        {entryMode === 'places' && (
          <div className="pt-3 border-t border-slate-800 space-y-3 text-xs">
            {!isPlacesReady && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Lock size={15} className="text-amber-400 shrink-0" />
                  <span>
                    A busca automática via <strong>Google Places API (New)</strong> está <strong>desativada</strong> porque nenhuma API Key autorizada foi validada em <strong>Configurações &gt; Google Places API</strong>. Utilize <strong>Cadastro Manual</strong> ou <strong>Importar CSV</strong>, ou valide a chave nas configurações.
                  </span>
                </div>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="px-3 py-1.5 rounded-lg bg-[#D4A72C] text-slate-950 font-bold text-xs hover:brightness-110 shrink-0 cursor-pointer"
                  >
                    Configurar Google Places
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Estado (UF)</label>
                <select
                  value={placesState}
                  onChange={(e) => setPlacesState(e.target.value)}
                  disabled={!isPlacesReady}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white disabled:opacity-50"
                >
                  <option value="SP">São Paulo (SP)</option>
                  <option value="RJ">Rio de Janeiro (RJ)</option>
                  <option value="MG">Minas Gerais (MG)</option>
                  <option value="PR">Paraná (PR)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Cidade</label>
                <input
                  type="text"
                  value={placesCity}
                  onChange={(e) => setPlacesCity(e.target.value)}
                  disabled={!isPlacesReady}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Segmento</label>
                <input
                  type="text"
                  value={placesSegment}
                  onChange={(e) => setPlacesSegment(e.target.value)}
                  disabled={!isPlacesReady}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Raio</label>
                <select
                  value={placesRadius}
                  onChange={(e) => setPlacesRadius(Number(e.target.value))}
                  disabled={!isPlacesReady}
                  className="w-full bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white disabled:opacity-50"
                >
                  <option value={5}>5 km</option>
                  <option value={10}>10 km</option>
                  <option value={25}>25 km</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handlePlacesSearch}
                  disabled={!isPlacesReady || placesLoading}
                  className="w-full py-2 px-4 rounded-lg bg-[#D4A72C] text-slate-950 font-bold disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Radar size={14} className={placesLoading ? 'animate-spin' : ''} />
                  <span>{placesLoading ? 'Buscando...' : 'Consultar Places API'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : feedback.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-wrap items-center gap-3 text-xs">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filtrar empresas por nome, cidade, telefone ou site..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-[#151926] border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
          />
        </div>

        <select
          value={segmentFilter}
          onChange={(e) => setSegmentFilter(e.target.value)}
          className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
        >
          <option value="all">Todos Segmentos ({prospects.length})</option>
          {segmentsList.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={websiteFilter}
          onChange={(e) => setWebsiteFilter(e.target.value as any)}
          className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
        >
          <option value="all">Todos (Com/Sem Site)</option>
          <option value="sem_site">Apenas Sem Website</option>
          <option value="com_site">Apenas Com Website</option>
        </select>

        <select
          value={auditFilter}
          onChange={(e) => setAuditFilter(e.target.value as any)}
          className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
        >
          <option value="all">Auditoria: Todas</option>
          <option value="auditado">Auditadas</option>
          <option value="pendente">Aguardando Auditoria</option>
        </select>
      </div>

      {/* Empty State */}
      {filteredProspects.length === 0 ? (
        <div className="p-10 text-center rounded-xl bg-[#11141E] border border-slate-800 text-slate-400 text-xs space-y-2">
          <Radar size={28} className="mx-auto text-slate-600 mb-1" />
          <div className="font-semibold text-slate-300 text-sm">
            {prospects.length === 0
              ? 'Nenhuma empresa cadastrada na Prospecção'
              : 'Nenhuma empresa corresponde aos filtros aplicados'}
          </div>
          <p className="max-w-md mx-auto text-[11px] text-slate-500">
            Cadastre empresas manualmente ou importe uma planilha CSV acima para auditar os sites individualmente e enviar oportunidades válidas para o CRM.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProspects.map((prospect) => {
            const audit = prospect.technicalAudit;
            const duplicateCrm = isDuplicateInCrm(prospect);
            const isAuditing = auditingId === prospect.id;
            const isImporting = importingId === prospect.id;

            return (
              <div
                key={prospect.id}
                className="p-4 rounded-xl bg-[#11141E] border border-slate-800 hover:border-[#D4A72C]/50 transition-all shadow-sm flex flex-col justify-between gap-3"
              >
                <div className="space-y-3">
                  {/* Top Info */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-white truncate">{prospect.company}</h3>
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {prospect.source === 'csv'
                            ? 'CSV'
                            : prospect.source === 'google_places'
                            ? 'Places'
                            : 'Manual'}
                        </span>
                        {duplicateCrm ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Já existe no CRM
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            Sem duplicidade no CRM
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>{prospect.segment || 'Geral'}</span>
                        {(prospect.city || prospect.state) && (
                          <>
                            <span>•</span>
                            <span>
                              {prospect.city}
                              {prospect.state ? ` - ${prospect.state}` : ''}
                            </span>
                          </>
                        )}
                        {prospect.phone && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{prospect.phone}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {audit?.checkedAt ? (
                        <div className="text-xs font-mono font-bold text-slate-300">
                          Score:{' '}
                          <span className={audit.score < 50 ? 'text-rose-400' : 'text-emerald-400'}>
                            {audit.score}/100
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                          Não auditado
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Technical Diagnostic */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Website:</span>
                      {prospect.websiteUrl ? (
                        <a
                          href={
                            prospect.websiteUrl.startsWith('http')
                              ? prospect.websiteUrl
                              : `https://${prospect.websiteUrl}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:underline font-mono flex items-center gap-1 truncate max-w-[240px]"
                        >
                          <Globe size={11} className="shrink-0" />
                          <span className="truncate">{prospect.websiteUrl}</span>
                          <ExternalLink size={10} className="shrink-0" />
                        </a>
                      ) : (
                        <span className="text-rose-400 font-bold flex items-center gap-1">
                          <ShieldAlert size={12} /> Sem website informado
                        </span>
                      )}
                    </div>

                    {audit?.checkedAt && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60 text-[10px]">
                        {audit.httpStatus !== undefined && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono">
                            HTTP {audit.httpStatus}
                          </span>
                        )}
                        {audit.responseTimeMs !== undefined && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono">
                            {audit.responseTimeMs}ms
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            audit.ssl ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {audit.ssl ? 'SSL Ativo' : 'Sem HTTPS'}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            audit.mobileReady
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {audit.mobileReady ? 'Viewport Mobile OK' : 'Sem Viewport Mobile'}
                        </span>
                      </div>
                    )}

                    <div className="text-[11px] text-slate-300 space-y-1 pt-1 border-t border-slate-800/60">
                      {audit?.issues?.map((issue, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-slate-400">
                          <span className="w-1 h-1 rounded-full bg-[#D4A72C] mt-1.5 shrink-0" />
                          <span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleAuditProspect(prospect)}
                      disabled={isAuditing}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAuditing ? (
                        <RefreshCw size={12} className="animate-spin text-[#D4A72C]" />
                      ) : (
                        <Sparkles size={12} className="text-[#D4A72C]" />
                      )}
                      <span>{isAuditing ? 'Auditando HTTP...' : 'Auditar Site'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteProspect(prospect.id)}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white cursor-pointer"
                      title="Remover da lista"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSendToCrm(prospect)}
                    disabled={duplicateCrm || isImporting}
                    className="px-3 py-1.5 rounded-lg bg-[#D4A72C] hover:bg-[#b88e1e] text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download size={13} />
                    <span>{duplicateCrm ? 'Já está no CRM' : isImporting ? 'Enviando...' : 'Importar para CRM'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
