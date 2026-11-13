import { CircleCheck, CircleSlash, CircleX } from 'lucide-react';
import type { ChatTurnWithEvents } from '../../../../api/types.ts';
import { cx } from '../../../../components/cx.ts';
import { tokens } from '../../chat-text.ts';
import { PLAN_COST } from '../../context/context-text.ts';
import { ranLine } from '../../runs/runs-state.ts';
import { activitySummary } from '../model/current-action.ts';
import { roundedDuration } from '../model/format.ts';
import type { TurnModel } from '../model/parts.ts';

const ENDINGS = {
  done: { icon: CircleCheck, words: 'Worked for', bare: 'Done', tone: 'text-done' },
  failed: { icon: CircleX, words: 'Failed after', bare: 'Failed', tone: 'text-failed' },
  stopped: { icon: CircleSlash, words: 'Stopped after', bare: 'Stopped', tone: 'text-dim' },
} as const;

/** Tokens in and out (cached ones), and the cost: the plan's for a login's turn, else the money the harness gives. */
function usageWords(usage: NonNullable<TurnModel['usage']>, onPlan: boolean): string {
  const cached = usage.cachedInputTokens ? ` (${tokens(usage.cachedInputTokens)} cached)` : '';
  const cost = onPlan
    ? ` · ${PLAN_COST}`
    : usage.costUsd === undefined
      ? ''
      : ` · $${usage.costUsd.toFixed(usage.costUsd < 1 ? 3 : 2)}`;
  return `${tokens(usage.inputTokens)} in${cached} · ${tokens(usage.outputTokens)} out${cost}`;
}

/**
 * A finished turn's quiet last line (S5.2): "Worked for 3m · ran 4 commands, called 6 tools" (or failed, stopped),
 * what it ran with (its mode, model and effort, since 2026-11-13), and the tokens; Copy sits beside it
 * (`MessageActions`).
 */
export function TurnFooter({
  turn,
  model,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly model: TurnModel;
}) {
  if (turn.status !== 'done' && turn.status !== 'failed' && turn.status !== 'stopped') return null;
  const ending = ENDINGS[turn.status];
  const Icon = ending.icon;
  const took =
    model.durationMs === undefined ? ending.bare : `${ending.words} ${roundedDuration(model.durationMs)}`;
  const summary = activitySummary(model);
  const ran = ranLine(turn);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-dim">
        <Icon size={12} aria-hidden="true" className={cx('shrink-0', ending.tone)} />
        <span className="font-semibold">{took}</span>
        {summary && <span className="min-w-0">· {summary}</span>}
      </span>
      {ran && <span title="What this turn ran with">{ran}</span>}
      {model.usage && (
        <span className="tabular">{usageWords(model.usage, turn.usage?.includedInPlan === true)}</span>
      )}
    </div>
  );
}
