import { type KeyboardEvent, useRef } from 'react';
import { cx } from '../../components/cx.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import type { AgentRef } from '../../components/feed/kinds.ts';
import { Avatar } from '../../components/ui/Avatar.tsx';

/** A team the dock makes tasks for: its flow and its Lead, whose chip picks it. */
export interface QuickTeam {
  readonly flowId: string;
  readonly flowName: string;
  readonly lead: { readonly principalId: string; readonly name: string; readonly kind: 'person' | 'agent' };
  /** An agent Lead's icon. */
  readonly face?: AgentRef | undefined;
  /** The person leads the team: the task goes straight into its first step, else it waits in Queued. */
  readonly leads: boolean;
}

/** What a made task says: its key and where it went ("queued", "at Develop"). */
export interface QuickMade {
  readonly key: string;
  readonly where: string;
}

/** A Lead's chip: its face and name, a radio in the ARIA sense. */
function LeadChip({
  team,
  on,
  focusable,
  companyId,
  onPick,
  onKey,
  chipRef,
}: {
  readonly team: QuickTeam;
  readonly on: boolean;
  readonly focusable: boolean;
  readonly companyId: string;
  readonly onPick: () => void;
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly chipRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, so each choice shows a face.
    <button
      ref={chipRef}
      type="button"
      role="radio"
      aria-checked={on}
      title={team.flowName}
      tabIndex={focusable ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKey}
      className={cx(
        'inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150',
        on
          ? 'bg-surface text-ink shadow-card ring-1 ring-blue'
          : 'text-ink-2 hover:bg-surface hover:text-ink',
      )}
    >
      {team.face ? (
        <AgentIcon agent={team.face} size="xs" companyId={companyId} />
      ) : (
        <Avatar name={team.lead.name} size="xs" />
      )}
      <span className="truncate">{team.lead.name}</span>
    </button>
  );
}

/** The Leads' chips, one picked (arrow keys move it, as a radio group). */
export function LeadChips({
  teams,
  team,
  companyId,
  onPick,
}: {
  readonly teams: readonly QuickTeam[];
  readonly team: QuickTeam | undefined;
  readonly companyId: string;
  readonly onPick: (flowId: string | undefined) => void;
}) {
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const index = team ? teams.indexOf(team) : 0;
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (at + step + teams.length) % teams.length;
    onPick(teams[next]?.flowId);
    chips.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Team" className="mt-2 flex flex-wrap gap-1">
      {teams.map((t, at) => (
        <LeadChip
          key={t.flowId}
          team={t}
          on={t === team}
          focusable={at === index}
          companyId={companyId}
          onPick={() => onPick(t.flowId)}
          onKey={(event) => onKey(event, at)}
          chipRef={(element) => {
            chips.current[at] = element;
          }}
        />
      ))}
    </div>
  );
}
