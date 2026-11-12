import { Maximize2, MessagesSquare, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { IconButton, iconButtonClass } from '../../components/ui/IconButton.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';
import { ReportFace } from './ReportFace.tsx';
import { DOT_WORDS, type RailReport } from './standing.ts';

/** Which of a Lead's chats the rail shows: its main chat with you, or its team chat (where its team's events wake it). */
export type DockMode = 'main' | 'team';

/** Main / Team chat, for a Lead. */
function ModeSwitch({
  mode,
  onMode,
}: {
  readonly mode: DockMode;
  readonly onMode: (mode: DockMode) => void;
}) {
  const option = (value: DockMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
      className={cx(
        'h-6 cursor-pointer rounded-full px-2 text-2xs font-semibold whitespace-nowrap transition-colors',
        mode === value ? 'bg-surface text-ink shadow-card' : 'text-dim hover:text-ink',
      )}
    >
      {label}
    </button>
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: two pressed buttons, as the tabs' small cousins.
    <div
      role="group"
      aria-label="Which chat"
      className="inline-flex shrink-0 rounded-full bg-surface-3 p-0.5"
    >
      {option('main', 'With you')}
      {option('team', 'Team chat')}
    </div>
  );
}

export interface DockedChatsProps {
  readonly reports: readonly RailReport[];
  readonly selected: RailReport | undefined;
  readonly onPick: (agentId: string) => void;
  readonly mode: DockMode;
  readonly onMode: (mode: DockMode) => void;
  /** The chat page with this chat open ("Open full chat"); none before a chat exists. */
  readonly fullHref: string | undefined;
  /** Starts a new chat with the agent on the next message (admins and owners); none hides it. */
  readonly onNew?: (() => void) | undefined;
  /** The chat itself: its thread and composer. */
  readonly body: ReactNode;
}

/** The open agent's face, name and role (and what its dot says), and the chat's actions. */
function DockHeader({
  selected,
  mode,
  fullHref,
  onNew,
}: Pick<DockedChatsProps, 'mode' | 'fullHref' | 'onNew'> & { readonly selected: RailReport }) {
  const { agent } = selected.report;
  const team = mode === 'team' ? selected.report.team : null;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AgentIcon agent={selected.face} size="sm" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold text-ink">{agent.name}</p>
        <p className="truncate text-2xs text-dim">
          {team ? `${team.name}: team` : agent.roleTitle}
          {selected.dot && <span className="text-ink-2"> · {DOT_WORDS[selected.dot]}</span>}
        </p>
      </div>
      {onNew && mode === 'main' && (
        <IconButton label="New chat" icon={SquarePen} size="sm" tooltip="bottom" onClick={onNew} />
      )}
      {fullHref && (
        <Tooltip label="Open full chat" side="bottom-end">
          <Link to={fullHref} aria-label="Open full chat" className={iconButtonClass({ size: 'sm' })}>
            <Maximize2 size={15} strokeWidth={2} aria-hidden="true" />
          </Link>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The right rail's Chats view (docs/harness.md "Your direct reports in the rail"): a small header with the open agent
 * (its face, name and role, New chat and Open full chat), the switcher among your direct reports (their faces in a row,
 * with their dots) and, for a Lead, With you / Team chat; under it the chat, compact, filling the rest.
 */
export function DockedChats({
  reports,
  selected,
  onPick,
  mode,
  onMode,
  fullHref,
  onNew,
  body,
}: DockedChatsProps) {
  if (reports.length === 0 || selected === undefined)
    return (
      <EmptyState
        icon={MessagesSquare}
        tone="blue"
        size="sm"
        title="No direct reports yet"
        className="my-auto"
      >
        Agents that report to you on the org chart show here, to chat with them from any page.
      </EmptyState>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col font-reading">
      <div className="grid gap-2 px-1 pb-2">
        <DockHeader selected={selected} mode={mode} fullHref={fullHref} onNew={onNew} />
        {(reports.length > 1 || selected.report.team) && (
          <div className="flex min-w-0 items-center gap-2">
            <ul
              aria-label="Your direct reports"
              className="scroll-quiet flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto p-1"
            >
              {reports.length > 1 &&
                reports.map((r) => (
                  <li key={r.report.agent.id} className="shrink-0">
                    <ReportFace
                      report={r}
                      size="xs"
                      selected={r === selected}
                      onPick={() => onPick(r.report.agent.id)}
                    />
                  </li>
                ))}
            </ul>
            {selected.report.team && <ModeSwitch mode={mode} onMode={onMode} />}
          </div>
        )}
      </div>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col border-t border-line">{body}</div>
    </div>
  );
}
