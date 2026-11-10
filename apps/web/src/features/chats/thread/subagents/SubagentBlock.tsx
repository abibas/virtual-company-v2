import { Bot, CornerDownRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../../components/cx.ts';
import { ActionWords } from '../activity/ActionWords.tsx';
import { Disclosure } from '../activity/Disclosure.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { between, elapsed, modelLabel, plural, roundedDuration } from '../model/format.ts';
import type { Part, SubagentState } from '../model/parts.ts';
import { type ToolWords, toolWords } from '../model/tool-kinds.ts';
import { SubagentMark } from '../status/ActionHistory.tsx';
import { useNow } from '../status/use-now.ts';

const STATUS_WORDS = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
} as const;
const STATUS_TONE = {
  running: 'text-blue',
  done: 'text-done',
  failed: 'text-failed',
  interrupted: 'text-dim',
} as const;

/** What it does now: the step its harness reported, else its latest call still running. */
function latestStep(state: SubagentState, parts: readonly Part[]): ToolWords {
  if (state.event.lastStep) return { verb: state.event.lastStep };
  const calls = parts.flatMap((part) => (part.kind === 'tools' ? part.calls : []));
  const last = calls.at(-1);
  if (last) return toolWords(last.name, last.summary, last.result !== undefined);
  return { verb: 'Starting…' };
}

/** Its steps without its last text when that is its answer, which shows below as the Result. */
function stepsOf(parts: readonly Part[], summary: string | undefined): readonly Part[] {
  const last = parts.at(-1);
  if (!summary || last?.kind !== 'text') return parts;
  const answer = summary.trim();
  const text = last.text.trim();
  return answer.startsWith(text.slice(0, 200)) ? parts.slice(0, -1) : parts;
}

function Chip({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-3 px-1.5 text-2xs font-semibold text-ink-2">
      {children}
    </span>
  );
}

/** Its status and time: "Running · 45s" (live), "Done · 1m". */
function StatusLine({ state }: { readonly state: SubagentState }) {
  const { status } = state.event;
  const now = useNow(status === 'running');
  const ms =
    status === 'running'
      ? now - new Date(state.startedAt).getTime()
      : between(state.startedAt, state.endedAt);
  const time = ms === undefined ? '' : status === 'running' ? elapsed(ms) : roundedDuration(ms);
  return (
    <span
      className={cx(
        'ml-auto inline-flex shrink-0 items-center gap-1.5 text-2xs font-semibold',
        STATUS_TONE[status],
      )}
    >
      <SubagentMark state={state} />
      {STATUS_WORDS[status]}
      {time && <span className="font-normal text-dim tabular">· {time}</span>}
    </span>
  );
}

/** The folded block's face: the type and chips, the status, the description, the latest step or the step count. */
function SubagentSummary({
  state,
  parts,
}: {
  readonly state: SubagentState;
  readonly parts: readonly Part[];
}) {
  const { agentType, description, model, background, status } = state.event;
  return (
    <span className="grid min-w-0 flex-1 gap-1">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-review-soft text-review">
          <Bot size={12} aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold text-ink">{agentType}</span>
        {model && <Chip>{modelLabel(model)}</Chip>}
        {background && <Chip>background</Chip>}
        <StatusLine state={state} />
      </span>
      {description && <span className="truncate pl-7 text-sm text-ink-2">{description}</span>}
      {status === 'running' ? (
        <span
          key={state.event.lastStep ?? state.steps}
          className="flex min-w-0 items-center gap-1.5 pl-7 text-xs text-dim motion-safe:animate-roll-in"
        >
          <CornerDownRight size={11} aria-hidden="true" className="shrink-0 text-faint" />
          <ActionWords words={latestStep(state, parts)} />
        </span>
      ) : (
        state.steps > 0 && (
          <span className="pl-7 text-xs text-faint">{plural(state.steps, 'step', 'steps')}</span>
        )
      )}
    </span>
  );
}

/**
 * A subagent's block (S5.2): its type, model and "background" chips, its description, its status with a live timer,
 * its latest step while it runs or "N steps" once folded; opened, its own events indented (`renderParts`, the same
 * renderer as the main reply), then its answer as Markdown.
 */
export function SubagentBlock({
  state,
  parts,
  renderParts,
}: {
  readonly state: SubagentState;
  readonly parts: readonly Part[];
  readonly renderParts: (parts: readonly Part[], live: boolean) => ReactNode;
}) {
  const { agentType, description, status, summary } = state.event;
  const running = status === 'running';
  const steps = stepsOf(parts, summary);
  return (
    <section
      aria-label={`${agentType} agent: ${description}`}
      className="rounded-xl bg-surface-2/60 ring-1 ring-line ring-inset"
    >
      <Disclosure
        buttonClassName="w-full items-start rounded-xl px-3.5 py-2.5 hover:bg-surface-2"
        summary={<SubagentSummary state={state} parts={parts} />}
      >
        <div className="grid gap-3 border-t border-line px-3.5 py-3">
          {steps.length > 0 ? (
            <div className="ml-2 grid min-w-0 gap-1.5 border-l border-line pl-3">
              {renderParts(steps, running)}
            </div>
          ) : (
            <p className="text-2xs text-faint">No steps yet.</p>
          )}
          {summary && (
            <div className="grid min-w-0 gap-1">
              <p className="text-2xs font-semibold text-faint">Result</p>
              <Markdown text={summary} />
            </div>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
