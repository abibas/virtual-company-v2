import { Clock } from 'lucide-react';
import type { ChatTurnWithEvents } from '../../../../api/types.ts';
import { Spinner } from '../../../../components/ui/Button.tsx';
import { ActionWords } from '../activity/ActionWords.tsx';
import { Disclosure } from '../activity/Disclosure.tsx';
import { currentAction, historyOf } from '../model/current-action.ts';
import { elapsed, modelLabel } from '../model/format.ts';
import type { TurnModel } from '../model/parts.ts';
import { ActionHistory } from './ActionHistory.tsx';
import { useNow } from './use-now.ts';

/** What the turn runs on, from its `init` or the chat's: "Opus 5.5 · high". */
export interface RunsOn {
  readonly model: string | null;
  readonly effort?: string | undefined;
}

/**
 * The pill: a spinner, "Working" with a soft shimmer (or "Reconnecting…" while the turn's runner is away and the turn
 * waits for it, S5.4), the live time, and the model and effort.
 */
function WorkingPill({
  since,
  runsOn,
  detached,
}: {
  readonly since: string;
  readonly runsOn: RunsOn | undefined;
  readonly detached: boolean;
}) {
  const now = useNow(true);
  const meta = [runsOn?.model ? modelLabel(runsOn.model) : undefined, runsOn?.effort]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="inline-flex h-7 w-fit max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 text-xs ring-1 ring-line ring-inset">
      <Spinner size={12} className={detached ? 'text-pending' : 'text-blue'} />
      {detached ? (
        <span
          className="font-semibold text-pending"
          title="The agent's machine lost its link; the turn goes on there and shows again when it is back"
        >
          Reconnecting…
        </span>
      ) : (
        <span className="text-shimmer font-semibold motion-safe:animate-shimmer">Working</span>
      )}
      <span aria-hidden="true" className="tabular text-dim">
        · {elapsed(now - new Date(since).getTime())}
      </span>
      {meta && <span className="min-w-0 truncate text-faint">· {meta}</span>}
    </div>
  );
}

/** The current action, rolling in as each event arrives, opening to the turn's action history. */
function CurrentActionRow({ model }: { readonly model: TurnModel }) {
  const line = currentAction(model.current);
  const history = historyOf(model);
  const Icon = line.icon;
  return (
    <Disclosure
      label={`${line.by ? `${line.by}: ` : ''}${line.words.verb}${line.words.target ? ` ${line.words.target}` : ''}. Show the actions so far (${history.length})`}
      buttonClassName="w-fit max-w-full items-center rounded-md py-0.5 pr-1.5 pl-1 text-sm text-dim hover:bg-surface-2 hover:text-ink-2"
      summary={
        <span key={model.current.seq} className="flex min-w-0 items-center gap-2 motion-safe:animate-roll-in">
          <Icon size={13} aria-hidden="true" className="shrink-0 text-blue" />
          {line.by && <span className="shrink-0 font-semibold text-ink-2">{line.by}</span>}
          <ActionWords words={line.words} />
          {history.length > 0 && <span className="shrink-0 text-faint tabular">· {history.length}</span>}
        </span>
      }
    >
      <ActionHistory items={history} />
    </Disclosure>
  );
}

/**
 * A running turn's live status (S5.2): the working pill and the current action. Screen readers hear the action as
 * it changes (`aria-live`), not the ticking time.
 */
export function WorkingStatus({
  turn,
  model,
  runsOn,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly model: TurnModel;
  readonly runsOn: RunsOn | undefined;
}) {
  const line = currentAction(model.current);
  return (
    <div className="grid justify-items-start gap-1.5">
      <WorkingPill
        since={turn.startedAt ?? turn.createdAt}
        runsOn={runsOn}
        detached={turn.detached === true}
      />
      <CurrentActionRow model={model} />
      <p aria-live="polite" className="sr-only">
        {line.by ? `${line.by}: ` : ''}
        {line.words.verb} {line.words.target ?? ''}
      </p>
    </div>
  );
}

/** A turn waiting for its machine. */
export function QueuedStatus() {
  return (
    <div className="inline-flex h-7 w-fit items-center gap-2 rounded-full bg-surface-2 px-3 text-xs text-dim ring-1 ring-line ring-inset">
      <Clock size={12} aria-hidden="true" className="shrink-0" />
      Waiting for the machine…
    </div>
  );
}
