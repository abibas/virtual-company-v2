import { ChevronRight } from 'lucide-react';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { OUTCOME, TONE_DOT } from './outcomes.ts';
import { StoryAside, StoryStepRow, When } from './StoryStepRow.tsx';
import type { StoryRound as Round } from './story.ts';

/** Its steps folded into one line: each step's name with its outcome's dot. */
function Folded({ round }: { readonly round: Round }) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-dim">
      {round.steps.map((step) => (
        <span key={step.id} className="inline-flex items-center gap-1" title={OUTCOME[step.outcome].label}>
          <span
            aria-hidden="true"
            className={cx('size-1.5 rounded-full', TONE_DOT[OUTCOME[step.outcome].tone])}
          />
          {step.step.name}
        </span>
      ))}
    </span>
  );
}

/**
 * One round: a header (its number, when it began, Done or Cancelled at its end) that folds it to one line, then its
 * opening lines (the task made), its steps on a line, and Done.
 */
export function StoryRound({
  round,
  open,
  onToggle,
  nodes,
  load,
  onOpenFile,
  onConversation,
  me,
}: {
  readonly round: Round;
  readonly me: string | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly load: (artifact: TaskArtifact) => Promise<Blob>;
  readonly onOpenFile: (artifact: TaskArtifact) => void;
  readonly onConversation: (chatId: string) => void;
}) {
  const first = round.steps[0];
  const end = round.end;
  const endedByStep = end?.kind === 'cancelled' && round.steps.at(-1)?.outcome === 'cancelled';
  return (
    <section aria-label={`Round ${round.number}`} className="grid">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md text-left hover:bg-surface-2"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cx('shrink-0 text-dim transition-transform', open && 'rotate-90')}
        />
        <span className="shrink-0 text-xs font-bold tracking-wide text-ink uppercase">
          Round {round.number}
        </span>
        {open ? <span className="flex-1" /> : <Folded round={round} />}
        {end?.kind === 'done' && (
          <Badge tone="done" size="sm">
            Done
          </Badge>
        )}
        {end?.kind === 'cancelled' && (
          <Badge tone="pending" size="sm">
            Cancelled
          </Badge>
        )}
        {first && <When at={first.at} />}
      </button>
      {open && (
        <div className="grid pb-1">
          {round.opening.length > 0 && (
            <ul className="grid gap-0.5 py-1 pl-6">
              {round.opening.map((event) => (
                <StoryAside key={event.id} event={event} />
              ))}
            </ul>
          )}
          <ol className="relative before:absolute before:top-4 before:bottom-4 before:left-[7px] before:w-px before:bg-line-2">
            {round.steps.map((step) => (
              <StoryStepRow
                key={step.id}
                step={step}
                nodes={nodes}
                load={load}
                onOpenFile={onOpenFile}
                onConversation={onConversation}
                me={me}
              />
            ))}
          </ol>
          {end && !endedByStep && end.kind === 'cancelled' && (
            <ul className="grid py-1 pl-6">
              <StoryAside event={end} />
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
