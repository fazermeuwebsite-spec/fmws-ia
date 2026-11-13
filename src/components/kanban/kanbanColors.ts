import { KanbanColor } from '../../types';

export interface KanbanColorTheme {
  label: string;
  dot: string;
  badge: string;
  border: string;
  headerAccent: string;
}

export const KANBAN_COLORS: Record<KanbanColor, KanbanColorTheme> = {
  slate: {
    label: 'Grafite',
    dot: 'bg-slate-400',
    badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    border: 'border-slate-700/90',
    headerAccent: 'border-t-slate-500'
  },
  blue: {
    label: 'Azul',
    dot: 'bg-sky-400',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    border: 'border-sky-500/30',
    headerAccent: 'border-t-sky-500'
  },
  indigo: {
    label: 'Índigo',
    dot: 'bg-indigo-400',
    badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    border: 'border-indigo-500/30',
    headerAccent: 'border-t-indigo-500'
  },
  gold: {
    label: 'Dourado FMWS',
    dot: 'bg-[#D4A72C]',
    badge: 'bg-[#D4A72C]/15 text-[#D4A72C] border-[#D4A72C]/40',
    border: 'border-[#D4A72C]/40',
    headerAccent: 'border-t-[#D4A72C]'
  },
  amber: {
    label: 'Âmbar',
    dot: 'bg-amber-400',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    border: 'border-amber-500/30',
    headerAccent: 'border-t-amber-500'
  },
  emerald: {
    label: 'Esmeralda',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/30',
    headerAccent: 'border-t-emerald-500'
  },
  rose: {
    label: 'Rubi',
    dot: 'bg-rose-400',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    border: 'border-rose-500/30',
    headerAccent: 'border-t-rose-500'
  },
  purple: {
    label: 'Roxo',
    dot: 'bg-purple-400',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    border: 'border-purple-500/30',
    headerAccent: 'border-t-purple-500'
  }
};

export function getKanbanTheme(color?: KanbanColor): KanbanColorTheme {
  if (color && KANBAN_COLORS[color]) {
    return KANBAN_COLORS[color];
  }
  return KANBAN_COLORS.slate;
}
