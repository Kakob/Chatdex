import { Globe, Terminal, MessagesSquare, Bot, MessageCircle, type LucideIcon } from 'lucide-react';
import type { DataSource } from '../../types';

export interface SourceMeta {
  label: string;
  Icon: LucideIcon;
  iconClass: string;
  activeButtonClass: string;
}

export const SOURCE_META: Record<DataSource, SourceMeta> = {
  'claude.ai': {
    label: 'Claude.ai',
    Icon: Globe,
    iconClass: 'text-violet-500',
    activeButtonClass: 'bg-violet-600 text-white',
  },
  'claude-code': {
    label: 'Claude Code',
    Icon: Terminal,
    iconClass: 'text-emerald-500',
    activeButtonClass: 'bg-emerald-600 text-white',
  },
  chatgpt: {
    label: 'ChatGPT',
    Icon: MessagesSquare,
    iconClass: 'text-teal-500',
    activeButtonClass: 'bg-teal-600 text-white',
  },
  codex: {
    label: 'Codex',
    Icon: Bot,
    iconClass: 'text-sky-500',
    activeButtonClass: 'bg-sky-600 text-white',
  },
  chatdex: {
    label: 'Chatdex',
    Icon: MessageCircle,
    iconClass: 'text-rose-500',
    activeButtonClass: 'bg-rose-600 text-white',
  },
};

export const ALL_SOURCES = Object.keys(SOURCE_META) as DataSource[];

export function SourceIcon({
  source,
  size = 14,
  className,
}: {
  source: DataSource;
  size?: number;
  className?: string;
}) {
  const { Icon, iconClass } = SOURCE_META[source];
  return <Icon size={size} className={className ? `${iconClass} ${className}` : iconClass} />;
}
