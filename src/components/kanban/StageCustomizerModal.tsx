import React, { useState } from 'react';
import {
  X,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  SlidersHorizontal,
  AlertCircle,
  Save
} from 'lucide-react';
import { KanbanColor, KanbanStageConfig } from '../../types';
import { KANBAN_COLORS } from './kanbanColors';

interface StageCustomizerModalProps {
  title: string;
  subtitle: string;
  stages: KanbanStageConfig[];
  itemCountsByStage: Record<string, number>;
  onClose: () => void;
  onSave: (stages: KanbanStageConfig[]) => Promise<void>;
}

const COLOR_OPTIONS: KanbanColor[] = [
  'slate',
  'blue',
  'indigo',
  'gold',
  'amber',
  'emerald',
  'purple',
  'rose'
];

function slugifyStageId(label: string, existingIds: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'etapa';

  if (!existingIds.has(base)) return base;
  let i = 2;
  while (existingIds.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export const StageCustomizerModal: React.FC<StageCustomizerModalProps> = ({
  title,
  subtitle,
  stages,
  itemCountsByStage,
  onClose,
  onSave
}) => {
  const [localStages, setLocalStages] = useState<KanbanStageConfig[]>(
    [...stages].sort((a, b) => a.order - b.order)
  );
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState<KanbanColor>('gold');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRename = (id: string, label: string) => {
    setLocalStages((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  };

  const handleChangeColor = (id: string, color: KanbanColor) => {
    setLocalStages((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= localStages.length) return;
    const copy = [...localStages];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    setLocalStages(copy.map((s, idx) => ({ ...s, order: idx })));
  };

  const handleDelete = (stage: KanbanStageConfig) => {
    setErrorMsg(null);
    const count = itemCountsByStage[stage.id] || 0;
    if (count > 0) {
      setErrorMsg(
        `A etapa "${stage.label}" possui ${count} registro(s). Mova-os para outra etapa antes de excluir.`
      );
      return;
    }
    if (localStages.length <= 1) {
      setErrorMsg('O quadro deve possuir pelo menos uma etapa ativa.');
      return;
    }
    setLocalStages((prev) =>
      prev.filter((s) => s.id !== stage.id).map((s, idx) => ({ ...s, order: idx }))
    );
  };

  const handleAddStage = () => {
    setErrorMsg(null);
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const existingIds = new Set(localStages.map((s) => s.id));
    const id = slugifyStageId(trimmed, existingIds);
    setLocalStages((prev) => [
      ...prev,
      {
        id,
        label: trimmed,
        color: newColor,
        order: prev.length
      }
    ]);
    setNewLabel('');
  };

  const handlePersist = async () => {
    setErrorMsg(null);
    const invalid = localStages.some((s) => !s.label.trim());
    if (invalid) {
      setErrorMsg('Todas as etapas precisam ter um nome válido.');
      return;
    }

    setSaving(true);
    try {
      const normalized = localStages.map((s, idx) => ({
        ...s,
        label: s.label.trim(),
        order: idx
      }));
      await onSave(normalized);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao salvar etapas no banco.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/15 text-[#D4A72C] flex items-center justify-center">
              <SlidersHorizontal size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-[11px] text-slate-400">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Add new stage */}
          <div className="p-3.5 rounded-xl bg-[#090B10] border border-slate-800 space-y-2.5">
            <span className="text-[11px] font-bold text-[#D4A72C] uppercase tracking-wider block">
              Adicionar Nova Etapa
            </span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Nome da etapa (ex: Aprovação Diretoria)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddStage();
                  }
                }}
                className="flex-1 bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
              />
              <select
                value={newColor}
                onChange={(e) => setNewColor(e.target.value as KanbanColor)}
                className="bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#D4A72C]"
              >
                {COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    Cor: {KANBAN_COLORS[c].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddStage}
                disabled={!newLabel.trim()}
                className="px-4 py-2 rounded-lg bg-[#D4A72C] text-slate-950 font-bold hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus size={14} />
                <span>Incluir</span>
              </button>
            </div>
          </div>

          {/* Stages list */}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {localStages.map((stage, idx) => {
              const count = itemCountsByStage[stage.id] || 0;
              const theme = KANBAN_COLORS[stage.color] || KANBAN_COLORS.slate;
              return (
                <div
                  key={stage.id}
                  className="p-2.5 rounded-xl bg-[#090B10] border border-slate-800 flex flex-col sm:flex-row sm:items-center gap-2.5"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[11px] font-mono text-slate-500 w-5 text-center shrink-0">
                      {idx + 1}.
                    </span>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${theme.dot}`} />
                    <input
                      type="text"
                      value={stage.label}
                      onChange={(e) => handleRename(stage.id, e.target.value)}
                      className="flex-1 min-w-0 bg-[#151926] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-[#D4A72C]"
                    />
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {count} {count === 1 ? 'item' : 'itens'}
                    </span>

                    <select
                      value={stage.color}
                      onChange={(e) => handleChangeColor(stage.id, e.target.value as KanbanColor)}
                      className="bg-[#151926] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-[#D4A72C]"
                    >
                      {COLOR_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {KANBAN_COLORS[c].label}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMove(idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30"
                        title="Mover para cima / esquerda"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === localStages.length - 1}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30"
                        title="Mover para baixo / direita"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(stage)}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400"
                        title="Excluir etapa"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
              type="button"
              onClick={handlePersist}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save size={14} />
              <span>{saving ? 'Salvando...' : 'Salvar Etapas'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
