import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Download, 
  Calendar, 
  Filter, 
  Users, 
  CheckCircle2, 
  DollarSign,
  PieChart,
  Sparkles
} from 'lucide-react';
import { Lead, Client, FinancialTransaction, Proposal, Project, AIAgentConfig } from '../types';
import { formatDateBR } from '../utils/dateFormat';

interface ReportsModuleProps {
  leads: Lead[];
  clients: Client[];
  financial: FinancialTransaction[];
  proposals: Proposal[];
  projects: Project[];
  aiAgents?: AIAgentConfig[];
}

export const ReportsModule: React.FC<ReportsModuleProps> = ({
  leads,
  clients,
  financial,
  proposals,
  projects,
  aiAgents
}) => {
  const [period, setPeriod] = useState('mes_atual');

  const totalWonLeads = leads.filter(l => l.status === 'ganho').length;
  const conversionRate = leads.length > 0 ? ((totalWonLeads / leads.length) * 100).toFixed(1) : '0';

  const totalWonValue = leads.filter(l => l.status === 'ganho').reduce((acc, l) => acc + (l.value || 0), 0);
  const totalPipelineValue = leads.reduce((acc, l) => acc + (l.value || 0), 0);

  const websiteRevenue = financial
    .filter(f => f.type === 'receita' && f.category === 'desenvolvimento' && f.status === 'pago')
    .reduce((acc, f) => acc + f.value, 0);

  const recurringRevenue = financial
    .filter(f => f.type === 'receita' && (f.category === 'hospedagem' || f.category === 'manutencao') && f.status === 'pago')
    .reduce((acc, f) => acc + f.value, 0);

  const totalRealizedRevenue = websiteRevenue + recurringRevenue;
  const webShare = totalRealizedRevenue > 0 ? Math.round((websiteRevenue / totalRealizedRevenue) * 100) : 0;
  const recShare = totalRealizedRevenue > 0 ? Math.round((recurringRevenue / totalRealizedRevenue) * 100) : 0;

  const atendente = aiAgents?.find(a => a.id === 'atendente');
  const atendenteScore = atendente?.stats?.accuracyScore;

  // Real dynamic segment breakdown
  const segmentCounts: Record<string, number> = {};
  leads.forEach(l => {
    const seg = l.segment?.trim() || 'Não categorizado';
    segmentCounts[seg] = (segmentCounts[seg] || 0) + 1;
  });

  const segmentList = Object.entries(segmentCounts)
    .map(([name, count]) => ({
      name,
      count,
      share: leads.length > 0 ? Math.round((count / leads.length) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);

  // Export CSV
  const handleExportCSV = () => {
    const rows = [
      ['Tipo', 'Cliente/Empresa', 'Segmento', 'Valor (R$)', 'Status', 'Data'],
      ...leads.map(l => ['Lead CRM', l.company, l.segment, l.value, l.status, formatDateBR(l.createdAt)]),
      ...financial.map(f => [f.type.toUpperCase(), f.clientName, f.category, f.value, f.status, formatDateBR(f.dueDate)])
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(";")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FMWS_Relatorio_Comercial_${formatDateBR(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      {/* Top Header & Export */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-[#D4A72C]" />
            <span>Relatórios & Business Intelligence FMWS</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Indicadores de conversão, ticket médio, distribuição de receitas e produtividade</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="mes_atual">Mês Atual (Novembro 2026)</option>
            <option value="trimestre">Último Trimestre</option>
            <option value="ano">Ano 2026 Completo</option>
          </select>

          <button
            onClick={handleExportCSV}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download size={14} />
            <span>Exportar Relatório CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Taxa de Conversão Geral</div>
          <div className="text-2xl font-black text-emerald-400 font-mono mt-1">{conversionRate}%</div>
          <div className="text-[11px] text-slate-400 mt-1">{totalWonLeads} vendas de {leads.length} leads</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Volume Fechado (Ganhos)</div>
          <div className="text-2xl font-black text-[#D4A72C] font-mono mt-1">
            R$ {totalWonValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Vendas confirmadas</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Ticket Médio por Lead</div>
          <div className="text-2xl font-black text-white font-mono mt-1">
            R$ {(leads.length > 0 ? totalPipelineValue / leads.length : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{leads.length > 0 ? 'Média de valor orçado' : 'Sem dados'}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="text-xs text-slate-400 font-semibold uppercase">Precisão Atendente IA</div>
          <div className="text-2xl font-black text-purple-400 font-mono mt-1">
            {atendenteScore ? `${atendenteScore}%` : 'Sem dados'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {atendente?.stats?.interactionsToday ? `${atendente.stats.interactionsToday} interações hoje` : 'Aguardando atendimentos'}
          </div>
        </div>
      </div>

      {/* Charts & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Revenue Distribution */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Composição da Receita Realizada (Recorrente vs Projetos)
          </h3>

          {totalRealizedRevenue === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 italic bg-slate-900/30 rounded-lg border border-slate-800/60">
              Nenhuma receita paga registrada no período selecionado.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-semibold">Projetos de Desenvolvimento Web (Único)</span>
                  <span className="font-mono text-emerald-400 font-bold">R$ {websiteRevenue.toFixed(2)} ({webShare}%)</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full" style={{ width: `${webShare}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-semibold">Hospedagem Cloud & Suporte Mensal (MRR)</span>
                  <span className="font-mono text-[#D4A72C] font-bold">R$ {recurringRevenue.toFixed(2)} ({recShare}%)</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-[#D4A72C] h-full" style={{ width: `${recShare}%` }}></div>
                </div>
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
            * O faturamento recorrente (MRR) cobre os custos de infraestrutura e servidores da agência.
          </div>
        </div>

        {/* Lead Segments Breakdown */}
        <div className="p-5 rounded-xl bg-[#11141E] border border-slate-800 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Distribuição Real por Segmento de Mercado
          </h3>

          {segmentList.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 italic bg-slate-900/30 rounded-lg border border-slate-800/60">
              Nenhum segmento identificado ainda. Cadastre leads no CRM para gerar o mapa de demanda.
            </div>
          ) : (
            <div className="space-y-2.5">
              {segmentList.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{item.name}</span>
                    <span className="text-slate-400 font-mono">{item.count} lead(s) ({item.share}%)</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-[#D4A72C] to-amber-300 h-full" style={{ width: `${item.share}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
