import React, { useState } from 'react';
import { X, KanbanSquare, Plus, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { KanbanStageConfig, PriorityLevel, Project, ProjectStage, ProjectTask } from '../../types';
import { DateInputBR } from '../DateInputBR';
import { getLocalIsoDate } from '../../utils/dateFormat';

interface ProjectModalProps {
  project?: Project | null;
  stages: KanbanStageConfig[];
  currentUserName: string;
  onClose: () => void;
  onSave: (project: Partial<Project>) => Promise<void> | void;
  onDelete?: (projectId: string) => Promise<void> | void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  project,
  stages,
  currentUserName,
  onClose,
  onSave,
  onDelete
}) => {
  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  const defaultStage = orderedStages[0]?.id || 'briefing';

  const [title, setTitle] = useState(project?.title || '');
  const [clientName, setClientName] = useState(project?.clientName || '');
  const [stage, setStage] = useState<ProjectStage>(project?.stage || defaultStage);
  const [deadline, setDeadline] = useState(project?.deadline || getLocalIsoDate(15));
  const [priority, setPriority] = useState<PriorityLevel>(project?.priority || 'alta');
  const [budget, setBudget] = useState(project?.budget !== undefined ? String(project.budget) : '0');
  const [websitePreviewUrl, setWebsitePreviewUrl] = useState(project?.websitePreviewUrl || '');
  const [notes, setNotes] = useState(project?.notes || '');
  const [tasks, setTasks] = useState<ProjectTask[]>(project?.tasks || []);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    setTasks([
      ...tasks,
      {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: newTaskTitle.trim(),
        done: false,
        assignee: currentUserName
      }
    ]);
    setNewTaskTitle('');
  };

  const handleToggleTaskLocal = (id: string) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const handleRemoveTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
  };

  const doneCount = tasks.filter((t) => t.done).length;
  const computedProgress = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...(project ? { id: project.id } : {}),
        title: title.trim(),
        clientName: clientName.trim(),
        stage,
        deadline,
        priority,
        budget: parseFloat(budget) || 0,
        websitePreviewUrl: websitePreviewUrl.trim(),
        notes: notes.trim(),
        tasks,
        progress: computedProgress,
        manager: project?.manager || currentUserName,
        deliverables: project?.deliverables || []
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!project || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(project.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#151926] border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-6">
        <div className="p-4 bg-[#11141E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#D4A72C]/20 text-[#D4A72C] flex items-center justify-center">
              <KanbanSquare size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {project ? `Editar Projeto: ${project.title}` : 'Cadastrar Novo Projeto Web'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Fluxo de desenvolvimento, prazos, tarefas reais e observações
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Título do Projeto *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Website Institucional + SEO"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Cliente / Empresa *</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Lumina Arquitetura"
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Etapa de Desenvolvimento</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as ProjectStage)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-[#D4A72C]"
              >
                {orderedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Prazo de Entrega (Go-Live)</label>
              <DateInputBR
                value={deadline}
                onChange={setDeadline}
                required
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
              >
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Orçamento Aprovado (R$)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-[#D4A72C] font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Link de Homologação (Staging URL)</label>
            <input
              type="text"
              value={websitePreviewUrl}
              onChange={(e) => setWebsitePreviewUrl(e.target.value)}
              placeholder="https://staging.empresa.com.br"
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Observações Técnicas / Escopo</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Requisitos do cliente, acessos, domínio, observações de entrega..."
              className="w-full bg-[#090B10] border border-slate-700 rounded-lg p-2 text-white"
            />
          </div>

          {/* Checklist Tasks */}
          <div className="space-y-2 p-3 rounded-xl bg-[#090B10] border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-[11px] uppercase tracking-wider">
                Checklist de Tarefas ({doneCount}/{tasks.length} concluídas)
              </span>
              <span className="font-mono font-bold text-[#D4A72C]">{computedProgress}%</span>
            </div>

            {tasks.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic py-2">
                Nenhuma tarefa cadastrada. Adicione tarefas abaixo para acompanhar o progresso real do projeto.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-2 rounded bg-[#151926] border border-slate-800 gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleTaskLocal(task.id)}
                      className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
                    >
                      {task.done ? (
                        <CheckSquare size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Square size={14} className="text-slate-500 shrink-0" />
                      )}
                      <span className={task.done ? 'line-through text-slate-400 truncate' : 'text-slate-200 truncate'}>
                        {task.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveTask(task.id)}
                      className="text-slate-500 hover:text-rose-400 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                placeholder="Nova tarefa do projeto..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTask();
                  }
                }}
                className="flex-1 bg-[#151926] border border-slate-700 rounded-lg p-2 text-white"
              />
              <button
                type="button"
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim()}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <Plus size={13} />
                <span>Adicionar</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <div>
              {project && onDelete && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Excluir</span>
                </button>
              )}
              {project && onDelete && confirmDelete && (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 px-2.5 py-1.5 rounded-lg">
                  <AlertTriangle size={13} className="text-rose-400" />
                  <span className="text-rose-200 font-semibold">Confirmar?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold hover:bg-rose-500 cursor-pointer"
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 cursor-pointer"
                  >
                    Não
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold hover:brightness-110 shadow-md shadow-[#D4A72C]/10 cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar Projeto Web'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
