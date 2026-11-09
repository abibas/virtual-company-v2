import { Bot, Check, CircleSlash, X } from 'lucide-react';
import { Spinner } from '../../../../components/ui/Button.tsx';
import { ActionWords, CallMark } from '../activity/ActionWords.tsx';
import type { HistoryItem } from '../model/current-action.ts';
import type { SubagentState } from '../model/parts.ts';
import { toolIcon, toolWords } from '../model/tool-kinds.ts';

/** A subagent's state as a mark: a spinner while it runs, then done, failed or interrupted. */
export function SubagentMark({ state }: { readonly state: SubagentState }) {
  const { status } = state.event;
  if (status === 'running') return <Spinner size={12} className="text-blue" />;
  if (status === 'done')
    return <Check size={13} strokeWidth={2.5} aria-label="done" className="shrink-0 text-done" />;
  if (status === 'failed')
    return <X size={13} strokeWidth={2.5} aria-label="failed" className="shrink-0 text-failed" />;
  return <CircleSlash size={12} aria-label="interrupted" className="shrink-0 text-dim" />;
}

/** The running turn's actions so far, oldest first, one quiet line each (S5.2). */
export function ActionHistory({ items }: { readonly items: readonly HistoryItem[] }) {
  if (items.length === 0) return <p className="py-1.5 pl-6 text-2xs text-faint">No actions yet.</p>;
  return (
    <ol className="scroll-quiet ml-[7px] grid max-h-64 gap-0.5 overflow-y-auto border-l border-line py-1 pr-1 pl-3.5">
      {items.map((item) => {
        if (item.kind === 'subagent') {
          const { agentType, description } = item.state.event;
          const words = toolWords('Agent', '', item.state.event.status !== 'running', agentType);
          return (
            <li key={item.key} className="flex min-w-0 items-center gap-2 text-2xs text-dim">
              <Bot size={12} aria-hidden="true" className="shrink-0 text-faint" />
              <span className="shrink-0">{words.verb}</span>
              {description && <span className="min-w-0 truncate text-faint">{description}</span>}
              <span className="ml-auto flex shrink-0">
                <SubagentMark state={item.state} />
              </span>
            </li>
          );
        }
        const Icon = toolIcon(item.call.name);
        return (
          <li key={item.key} className="flex min-w-0 items-center gap-2 text-2xs text-dim">
            <Icon size={12} aria-hidden="true" className="shrink-0 text-faint" />
            <ActionWords
              words={toolWords(item.call.name, item.call.summary, item.call.result !== undefined)}
            />
            <span className="ml-auto flex shrink-0">
              <CallMark call={item.call} running />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
