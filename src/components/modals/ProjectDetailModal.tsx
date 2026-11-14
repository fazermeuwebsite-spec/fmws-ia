import React, { useState } from 'react';
import {
  X,
  KanbanSquare,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Clock,
  ExternalLink,
  History,
  Edit3,
  Save,
  User
} from 'lucide-react';
import { KanbanStageConfig, Project, ProjectStage, ProjectTask } from '../../types';
import { getKanbanTheme } from '../kanban/kanbanColors';
import { formatDateBR, formatDateTimeBR } from '../../utils/dateFormat';

interface ProjectDetailModalProps {
  project: Project;
  stages: KanbanStageConfig[];
  currentUserName: string;
  onClose: () => void;
  onEditProject: () => void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  onUpdateProject: (
    projectId: string,
    payload: Partial<Project> & { historyAction?: string }
  ) => Promise<void>;
}

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  project,
  stages,
  currentUserName,
  onClose,
  onEditProject,
  onDeleteProject,
  onUpdateProject
}) => {
  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  const currentStage = orderedStages.find((s) => s.id === project.stage);
  const stageTheme = getKanbanTheme(currentStage?.color);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [notesDraft, setNotesDraft] = useState(project.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingTask, setSavingTask] = useState(false);

  const tasks = project.tasks || [];
  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  const handleToggleTask = async (taskId: string) => {
    setSavingTask(true);
    try {
      const target = tasks.find((t) => t.id === taskId);
      const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
      const newDone = updatedTasks.filter((t) => t.done).length;
      const newProgress = updatedTasks.length > 0 ? Math.round((newDone / updatedTasks.length) * 100) : 0;
      await onUpdateProject(project.id, {
        tasks: updatedTasks,
        progress: newProgress,
        historyAction: target
          ? `Tarefa "${target.title}" marcada como ${!target.done ? 'concluída' : 'pendente'}`
          : 'Checklist atualizado'
      });
    } finally {
      setSavingTask(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const newTask: ProjectTask = {
        id: `t_${Date.now()}`,
        title: newTaskTitle.trim(),
        done: false,
        assignee: currentUserName
      };
      const updatedTasks = [...tasks, newTask];
      const newDone = updatedTasks.filter((t) => t.done).length;
      const newProgress = updatedTasks.length > 0 ? Math.round((newDone / updatedTasks.length) * 100) : 0;
      await onUpdateProject(project.id, {
        tasks: updatedTasks,
        progress: newProgress,
        historyAction: `Tarefa adicionada: "${newTask.title}"`
      });
      setNewTaskTitle('');
    } finally {
      setSavingTask(false);
    }
  };

  const handleRemoveTask = async (taskId: string) => {
    setSavingTask(true);
    try {
      const target = tasks.find((t) => t.id === taskId);
      const updatedTasks = tasks.filter((t) => t.id !== taskId);
      const newDone = updatedTasks.filter((t) => t.done).length;
      const newProgress = updatedTasks.length > 0 ? Math.round((newDone / updatedTasks.length) * 100) : 0;
      await onUpdateProject(project.id, {
        tasks: updatedTasks,
        progress: newProgress,
        historyAction: target ? `Tarefa removida: "${target.title}"` : 'Tarefa removida'
      });
    } finally {
      setSavingTask(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await onUpdateProject(project.id, {
        notes: notesDraft,
        historyAction: 'Observações do projeto atualizadas'
      });
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden my-6">
        {/* Header */}
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4A72C]/15 text-[#D4A72C] flex items-center justify-center shrink-0">
              <KanbanSquare size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{project.title}</h3>
              <p className="text-[11px] text-slate-400 truncate">
                Cliente: <strong className="text-slate-200">{project.clientName}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onEditProject}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Edit3 size={12} />
              <span>Editar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 text-xs max-h-[82vh] overflow-y-auto">
          {/* Meta summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Etapa Atual</span>
              <select
                value={project.stage}
                onChange={(e) =>
                  onUpdateProject(project.id, { stage: e.target.value as ProjectStage })
                }
                className={`w-full bg-[#151926] border rounded px-2 py-1 text-[11px] font-semibold focus:outline-none ${stageTheme.border} text-white`}
              >
                {orderedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Prazo de Entrega</span>
              <span className="text-white font-mono font-bold flex items-center gap-1.5">
                <Clock size={12} className="text-[#D4A72C]" />
                {formatDateBR(project.deadline, 'Não definido')}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Orçamento</span>
              <span className="text-[#D4A72C] font-mono font-bold">
                R$ {(project.budget || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800">
              <span className="text-[10px] text-slate-400 block mb-1">Responsável</span>
              <span className="text-slate-200 font-semibold flex items-center gap-1 truncate">
                <User size={12} className="text-slate-400 shrink-0" />
                <span className="truncate">{project.manager || currentUserName}</span>
              </span>
            </div>
          </div>

          {project.websitePreviewUrl && (
            <div className="p-3 rounded-xl bg-[#090B10] border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Ambiente de Homologação (Staging):</span>
              <a
                href={project.websitePreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:underline font-mono flex items-center gap-1"
              >
                <span>{project.websitePreviewUrl}</span>
                <ExternalLink size={12} />
              </a>
            </div>
          )}

          {/* Progress & Tasks Checklist */}
          <div className="p-4 rounded-xl bg-[#090B10] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                Checklist de Tarefas ({doneCount}/{tasks.length} concluídas)
              </span>
              <span className="font-mono font-bold text-[#D4A72C] text-sm">{progress}%</span>
            </div>

            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#D4A72C] to-amber-300 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            {tasks.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic py-2">
                Nenhuma tarefa vinculada a este projeto. Adicione tarefas abaixo para acompanhar o progresso real.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#151926] border border-slate-800 gap-2"
                  >
                    <button
                      type="button"
                      disabled={savingTask}
                      onClick={() => handleToggleTask(task.id)}
                      className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
                    >
                      {task.done ? (
                        <CheckSquare size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Square size={14} className="text-slate-500 shrink-0" />
                      )}
                      <span className={task.done ? 'line-through text-slate-400' : 'text-slate-200'}>
                        {task.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={savingTask}
                      onClick={() => handleRemoveTask(task.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                      title="Remover tarefa"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                placeholder="Adicionar nova tarefa..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTask();
                  }
                }}
                className="flex-1 bg-[#151926] border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
              />
              <button
                type="button"
                disabled={savingTask || !newTaskTitle.trim()}
                onClick={handleAddTask}
                className="px-3.5 py-2 rounded-lg bg-[#D4A72C] text-slate-950 font-bold hover:brightness-110 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14} />
                <span>Adicionar</span>
              </button>
            </div>
          </div>

          {/* Observations */}
          <div className="p-4 rounded-xl bg-[#090B10] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                Observações do Projeto
              </span>
              <button
                type="button"
                disabled={savingNotes || notesDraft === (project.notes || '')}
                onClick={handleSaveNotes}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-[#D4A72C] hover:text-slate-950 text-slate-200 font-semibold disabled:opacity-40 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Save size={12} />
                <span>{savingNotes ? 'Salvando...' : 'Salvar Notas'}</span>
              </button>
            </div>
            <textarea
              rows={3}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Registre observações técnicas, links de arquivos, credenciais temporárias ou feedback do cliente..."
              className="w-full bg-[#151926] border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          {/* History Log */}
          <div className="p-4 rounded-xl bg-[#090B10] border border-slate-800 space-y-2">
            <span className="font-bold text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <History size={13} className="text-[#D4A72C]" />
              <span>Histórico de Movimentações & Entregas ({project.history?.length || 0})</span>
            </span>

            {!project.history || project.history.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">Nenhum registro de movimentação até o momento.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {project.history.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-2 rounded-lg bg-[#151926] border border-slate-800/80 flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-200 text-[11px]">{entry.action}</span>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {entry.user} • {formatDateTimeBR(entry.date, { includeSeconds: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={async () => {
                await onDeleteProject(project.id);
                onClose();
              }}
              className="px-3.5 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Excluir Projeto</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
