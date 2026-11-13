import React, { useState } from 'react';
import { 
  DollarSign, 
  Plus, 
  Search, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  CreditCard, 
  Zap, 
  Trash2,
  TrendingUp,
  Building2
} from 'lucide-react';
import { FinancialTransaction } from '../types';

interface FinancialModuleProps {
  transactions: FinancialTransaction[];
  onOpenTransactionModal: () => void;
  onUpdateStatus: (id: string, status: 'pago' | 'pendente' | 'atrasado') => void;
  onDeleteTransaction: (id: string) => void;
  onSimulateAsaasPayment: () => void;
}

export const FinancialModule: React.FC<FinancialModuleProps> = ({
  transactions,
  onOpenTransactionModal,
  onUpdateStatus,
  onDeleteTransaction,
  onSimulateAsaasPayment
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'receita' | 'despesa'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pago' | 'pendente' | 'atrasado'>('all');

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = 
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.clientName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || t.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  const totalPaidRevenue = transactions
    .filter(t => t.type === 'receita' && t.status === 'pago')
    .reduce((acc, t) => acc + t.value, 0);

  const totalPendingRevenue = transactions
    .filter(t => t.type === 'receita' && t.status !== 'pago')
    .reduce((acc, t) => acc + t.value, 0);

  const totalExpenses = transactions
    .filter(t => t.type === 'despesa')
    .reduce((acc, t) => acc + t.value, 0);

  const netBalance = totalPaidRevenue - totalExpenses;

  return (
    <div className="space-y-5">
      {/* Financial Health Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Receitas Realizadas</span>
            <div className="w-6 h-6 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <ArrowDownLeft size={14} />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono mt-2">
            R$ {totalPaidRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">PIX, Boleto e Cartão compensados</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>A Receber / Em Aberto</span>
            <div className="w-6 h-6 rounded bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Clock size={14} />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono mt-2">
            R$ {totalPendingRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Cobranças ativas no Asaas</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Despesas Operacionais</span>
            <div className="w-6 h-6 rounded bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <ArrowUpRight size={14} />
            </div>
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono mt-2">
            R$ {totalExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Servidores, APIs e impostos</div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Saldo Líquido</span>
            <div className="w-6 h-6 rounded bg-[#D4A72C]/10 text-[#D4A72C] flex items-center justify-center">
              <TrendingUp size={14} />
            </div>
          </div>
          <div className="text-2xl font-black text-[#D4A72C] font-mono mt-2">
            R$ {netBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">Margem operacional positiva</div>
        </div>
      </div>

      {/* Asaas Integration & Simulator Action Bar */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar lançamento ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">Todas as Operações</option>
            <option value="receita">Apenas Receitas</option>
            <option value="despesa">Apenas Despesas</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">Todos os Status</option>
            <option value="pago">Pago / Compensado</option>
            <option value="pendente">Pendente</option>
            <option value="atrasado">Atrasado</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSimulateAsaasPayment}
            className="px-3.5 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Simula recebimento de webhook do Asaas confirmando pagamento"
          >
            <Zap size={14} className="text-blue-400" />
            <span>Simular Webhook Asaas (PIX)</span>
          </button>

          <button
            onClick={onOpenTransactionModal}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
          >
            <Plus size={15} />
            <span>Novo Lançamento</span>
          </button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-[#11141E] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#151926] text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4">Descrição / Cliente</th>
                <th className="py-3 px-4">Categoria</th>
                <th className="py-3 px-4">Vencimento</th>
                <th className="py-3 px-4">Valor</th>
                <th className="py-3 px-4">Método</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-slate-400">
                    Nenhum lançamento financeiro registrado. Cadastre novas receitas ou despesas pelo botão acima.
                  </td>
                </tr>
              ) : filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-900/60 transition-colors">
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      tx.type === 'receita' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}>
                      {tx.type === 'receita' ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                      {tx.type}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-white">{tx.description}</div>
                    <div className="text-[11px] text-slate-400">{tx.clientName}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-400 capitalize">
                    {tx.category}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    <div>{tx.dueDate}</div>
                    {tx.paymentDate && (
                      <div className="text-[10px] text-emerald-400">Pago em {tx.paymentDate}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-white">
                    <span className={tx.type === 'receita' ? 'text-emerald-400' : 'text-rose-400'}>
                      {tx.type === 'receita' ? '+' : '-'} R$ {tx.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {tx.paymentMethod}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={tx.status}
                      onChange={(e) => onUpdateStatus(tx.id, e.target.value as any)}
                      className={`text-[10px] font-bold rounded px-2 py-0.5 border uppercase focus:outline-none ${
                        tx.status === 'pago' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                        tx.status === 'pendente' ? 'bg-amber-950 text-amber-400 border-amber-800' :
                        'bg-rose-950 text-rose-400 border-rose-800'
                      }`}
                    >
                      <option value="pago">Pago</option>
                      <option value="pendente">Pendente</option>
                      <option value="atrasado">Atrasado</option>
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onDeleteTransaction(tx.id)}
                      className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-colors"
                      title="Excluir lançamento"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
