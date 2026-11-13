import React, { useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { KanbanStageConfig } from '../../types';
import { getKanbanTheme } from './kanbanColors';

interface KanbanBoardProps<T extends { id: string }> {
  stages: KanbanStageConfig[];
  items: T[];
  getItemStage: (item: T) => string;
  onMoveItem: (itemId: string, targetStageId: string) => void | Promise<void>;
  renderCard: (item: T, isDragging: boolean) => React.ReactNode;
  renderColumnSummary?: (stage: KanbanStageConfig, stageItems: T[]) => React.ReactNode;
  emptyStageMessage?: string;
  loading?: boolean;
  error?: string | null;
}

export function KanbanBoard<T extends { id: string }>({
  stages,
  items,
  getItemStage,
  onMoveItem,
  renderCard,
  renderColumnSummary,
  emptyStageMessage = 'Nenhum item nesta etapa',
  loading = false,
  error = null
}: KanbanBoardProps<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const orderedStages = [...stages].sort((a, b) => a.order - b.order);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggingId(itemId);
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStageId(null);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('text/plain') || draggingId;
    setDragOverStageId(null);
    setDraggingId(null);
    if (!itemId) return;

    const item = items.find((i) => i.id === itemId);
    if (!item || getItemStage(item) === targetStageId) return;

    await onMoveItem(itemId, targetStageId);
  };

  if (loading) {
    return (
      <div className="p-12 rounded-xl bg-[#11141E] border border-slate-800 flex items-center justify-center gap-2.5 text-xs text-slate-300">
        <RefreshCw size={16} className="animate-spin text-[#D4A72C]" />
        <span>Carregando quadro Kanban...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4 items-start">
        {orderedStages.map((stage) => {
          const stageItems = items.filter((item) => getItemStage(item) === stage.id);
          const theme = getKanbanTheme(stage.color);
          const isDropTarget = dragOverStageId === stage.id;

          return (
            <div
              key={stage.id}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={() => {
                if (dragOverStageId === stage.id) setDragOverStageId(null);
              }}
              onDrop={(e) => handleDrop(e, stage.id)}
              className={`w-[300px] sm:w-[316px] shrink-0 rounded-xl border border-t-2 transition-all flex flex-col bg-[#0d1017] max-h-[calc(100vh-265px)] ${
                theme.border
              } ${theme.headerAccent} ${
                isDropTarget
                  ? 'ring-2 ring-[#D4A72C]/70 bg-[#D4A72C]/5 border-[#D4A72C]/60'
                  : ''
              }`}
            >
              {/* Column Header */}
              <div className="p-3.5 border-b border-slate-800/80 bg-[#11141E]/95 rounded-t-[10px] shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${theme.dot}`} />
                    <span className="text-xs font-bold text-white truncate" title={stage.label}>
                      {stage.label}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono border shrink-0 ${theme.badge}`}
                  >
                    {stageItems.length}
                  </span>
                </div>

                {renderColumnSummary && (
                  <div className="mt-1.5">{renderColumnSummary(stage, stageItems)}</div>
                )}
              </div>

              {/* Cards Container */}
              <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1 min-h-[140px]">
                {stageItems.length === 0 ? (
                  <div
                    className={`p-5 rounded-lg border border-dashed text-center text-[11px] transition-colors ${
                      isDropTarget
                        ? 'border-[#D4A72C]/60 text-[#D4A72C] bg-[#D4A72C]/5'
                        : 'border-slate-800/80 text-slate-500'
                    }`}
                  >
                    {isDropTarget ? 'Solte o cartão aqui' : emptyStageMessage}
                  </div>
                ) : (
                  stageItems.map((item) => {
                    const isDragging = draggingId === item.id;
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        onDragEnd={handleDragEnd}
                        className={`cursor-grab active:cursor-grabbing transition-opacity ${
                          isDragging ? 'opacity-40' : 'opacity-100'
                        }`}
                      >
                        {renderCard(item, isDragging)}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
