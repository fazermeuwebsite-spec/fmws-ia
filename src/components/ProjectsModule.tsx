import React, { useState } from 'react';
import {
  KanbanSquare,
  Plus,
  Search,
  Clock,
  ExternalLink,
  Trash2,
  Edit3,
  SlidersHorizontal,
  CheckSquare,
  Eye
} from 'lucide-react';
import { KanbanStageConfig, PriorityLevel, Project, ProjectStage } from '../types';
import { KanbanBoard } from './kanban/KanbanBoard';
import { StageCustomizerModal } from './kanban/StageCustomizerModal';
import { getKanbanTheme } from './kanban/kanbanColors';
import { ProjectDetailModal } from './modals/ProjectDetailModal';

interface ProjectsModuleProps {
  projects: Project[];
  stages: KanbanStageConfig[];
  currentUserName: string;
  onSaveStages: (stages: KanbanStageConfig[]) => Promise<void>;
  onOpenProjectModal: (project?: Project) => void;
  onUpdateProjectStage: (projectId: string, newStage: ProjectStage) => Promise<void> | void;
  onUpdateProject: (
    projectId: string,
    payload: Partial<Project> & { historyAction?: string }
  ) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  loading?: boolean;
  error?: string | null;
}

const PRIORITY_STYLES: Record<PriorityLevel, { label: string; cls: string }> = {
  baixa: { label: 'Baixa', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  media: { label: 'Média', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  alta: { label: 'Alta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  urgente: { label: 'Urgente', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
};

export const ProjectsModule: React.FC<ProjectsModuleProps> = ({
  projects,
  stages,
  currentUserName,
  onSaveStages,
  onOpenProjectModal,
  onUpdateProjectStage,
  onUpdateProject,
  onDeleteProject,
  loading = false,
  error = null
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedStageFilter, setSelectedStageFilter] = useState<string>('all');
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);

  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  const stageMap = new Map<string, KanbanStageConfig>(orderedStages.map((s) => [s.id, s]));

  const filteredProjects = projects.filter((p) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.clientName.toLowerCase().includes(q) ||
      (p.manager || '').toLowerCase().includes(q);
    const matchesPriority = selectedPriority === 'all' || (p.priority || 'media') === selectedPriority;
    const matchesStage = selectedStageFilter === 'all' || p.stage === selectedStageFilter;
    return matchesSearch && matchesPriority && matchesStage;
  });

  const itemCountsByStage: Record<string, number> = {};
  for (const proj of projects) {
    itemCountsByStage[proj.stage] = (itemCountsByStage[proj.stage] || 0) + 1;
  }

  const activeDetailProject = detailProjectId
    ? projects.find((p) => p.id === detailProjectId) || null
    : null;

  const renderProjectCard = (proj: Project) => {
    const tasks = proj.tasks || [];
    const doneTasks = tasks.filter((t) => t.done).length;
    const totalTasks = tasks.length;
    const realProgress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const prio = PRIORITY_STYLES[proj.priority || 'media'] || PRIORITY_STYLES.media;
    const stageConfig = stageMap.get(proj.stage);
    const stageTheme = getKanbanTheme(stageConfig?.color);

    return (
      <div className="p-3.5 rounded-xl bg-[#151926] border border-slate-800/90 hover:border-[#D4A72C]/50 transition-all shadow-sm space-y-2.5 min-w-0">
        {/* Title & Actions */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setDetailProjectId(proj.id)}
            className="text-left min-w-0 flex-1 group cursor-pointer"
          >
            <h4 className="text-xs font-bold text-white group-hover:text-[#D4A72C] truncate">
              {proj.title}
            </h4>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              Cliente: <strong className="text-slate-300">{proj.clientName}</strong>
            </p>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${prio.cls}`}>
              {prio.label}
            </span>
          </div>
        </div>

        {/* Stage & Deadline */}
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded border font-semibold truncate max-w-[140px] ${stageTheme.badge}`}>
            {stageConfig?.label || proj.stage}
          </span>
          <span className="text-slate-400 font-mono flex items-center gap-1 shrink-0">
            <Clock size={11} className="text-[#D4A72C]" />
            {proj.deadline || 'Sem prazo'}
          </span>
        </div>

        {/* Real Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <CheckSquare size={11} className="text-emerald-400" />
              <span>
                {doneTasks}/{totalTasks} {totalTasks === 1 ? 'tarefa' : 'tarefas'}
              </span>
            </span>
            <span className="font-mono text-[#D4A72C] font-bold">{realProgress}%</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#D4A72C] to-amber-300 h-full transition-all"
              style={{ width: `${realProgress}%` }}
            />
          </div>
        </div>

        {/* Staging Link & Quick Buttons */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {proj.websitePreviewUrl ? (
            <a
              href={proj.websitePreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:underline truncate"
            >
              <ExternalLink size={10} />
              <span>Staging</span>
            </a>
          ) : (
            <span className="text-[10px] text-slate-500">Sem URL preview</span>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setDetailProjectId(proj.id)}
              className="px-2 py-1 rounded bg-[#D4A72C]/10 hover:bg-[#D4A72C] text-[#D4A72C] hover:text-slate-950 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="Abrir detalhes, checklist e histórico"
            >
              <Eye size={11} />
              <span>Detalhes</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenProjectModal(proj)}
              className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Editar projeto"
            >
              <Edit3 size={11} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteProject(proj.id)}
              className="p-1 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white cursor-pointer"
              title="Excluir projeto"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* Move Stage Dropdown */}
        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span className="shrink-0">Etapa:</span>
          <select
            value={proj.stage}
            onChange={(e) => onUpdateProjectStage(proj.id, e.target.value as ProjectStage)}
            className="flex-1 min-w-0 bg-[#090B10] border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            {orderedStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar projeto, cliente ou responsável..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#151926] border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#D4A72C]"
            />
          </div>

          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            <option value="all">Todas Prioridades</option>
            <option value="urgente">Urgente</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>

          <select
            value={selectedStageFilter}
            onChange={(e) => setSelectedStageFilter(e.target.value)}
            className="bg-[#151926] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#D4A72C]"
          >
            <option value="all">Todas as Etapas</option>
            {orderedStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCustomizerOpen(true)}
            className="px-3 py-2 rounded-lg bg-[#151926] border border-slate-700 hover:border-[#D4A72C]/60 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <SlidersHorizontal size={14} className="text-[#D4A72C]" />
            <span>Personalizar Etapas</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenProjectModal()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A72C] to-[#B88E1E] text-slate-950 font-bold text-xs hover:brightness-110 flex items-center gap-1.5 shadow-md shadow-[#D4A72C]/10 cursor-pointer"
          >
            <Plus size={15} />
            <span>Novo Projeto Web</span>
          </button>
        </div>
      </div>

      {projects.length === 0 && !loading && (
        <div className="p-4 rounded-xl bg-[#11141E] border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KanbanSquare size={16} className="text-[#D4A72C] shrink-0" />
            <span>
              Nenhum projeto web em andamento. Clique em <strong>"+ Novo Projeto Web"</strong> para iniciar o desenvolvimento.
            </span>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <KanbanBoard
        stages={orderedStages}
        items={filteredProjects}
        getItemStage={(proj) => proj.stage}
        onMoveItem={(projectId, targetStage) =>
          onUpdateProjectStage(projectId, targetStage as ProjectStage)
        }
        renderCard={(proj) => renderProjectCard(proj)}
        renderColumnSummary={(_stage, stageProjs) => {
          const avg =
            stageProjs.length > 0
              ? Math.round(
                  stageProjs.reduce((acc, p) => acc + (Number(p.progress) || 0), 0) /
                    stageProjs.length
                )
              : 0;
          return (
            <div className="text-[11px] font-mono text-slate-400">
              Progresso médio: <span className="text-[#D4A72C] font-semibold">{avg}%</span>
            </div>
          );
        }}
        emptyStageMessage="Arraste um projeto para cá"
        loading={loading}
        error={error}
      />

      {customizerOpen && (
        <StageCustomizerModal
          title="Personalizar Etapas de Desenvolvimento"
          subtitle="Renomeie, reordene, mude as cores ou crie novas fases de entrega de projetos"
          stages={orderedStages}
          itemCountsByStage={itemCountsByStage}
          onClose={() => setCustomizerOpen(false)}
          onSave={onSaveStages}
        />
      )}

      {activeDetailProject && (
        <ProjectDetailModal
          project={activeDetailProject}
          stages={orderedStages}
          currentUserName={currentUserName}
          onClose={() => setDetailProjectId(null)}
          onEditProject={() => {
            const p = activeDetailProject;
            setDetailProjectId(null);
            onOpenProjectModal(p);
          }}
          onDeleteProject={onDeleteProject}
          onUpdateProject={onUpdateProject}
        />
      )}
    </div>
  );
};
