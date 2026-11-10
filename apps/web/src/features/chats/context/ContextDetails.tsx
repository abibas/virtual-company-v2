import type { ReactNode } from 'react';
import { count, formatDateTime } from '../../../components/data/format.ts';
import { ContextFills } from './ContextFills.tsx';
import type { ConversationView, TurnTokens } from './context-state.ts';
import { costText, short } from './context-text.ts';

/** A titled group of the popover. */
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid gap-1.5 border-t border-line pt-3">
      <h4 className="text-xs font-semibold text-dim">{title}</h4>
      {children}
    </section>
  );
}

/** One figure: its name on the left, its value on the right. */
function Row({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm" title={hint}>
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular font-semibold text-ink">{children}</dd>
    </div>
  );
}

function LastTurn({ turn }: { readonly turn: TurnTokens }) {
  return (
    <dl className="grid gap-1">
      <Row label="Input" hint="Every input token of the turn, cached ones included">
        {short(turn.input)}
      </Row>
      <Row label="Read from cache">{short(turn.cacheRead)}</Row>
      <Row label="Written to cache" hint="The main agent's requests">
        {short(turn.cacheWrite)}
      </Row>
      <Row label="Output">{short(turn.output)}</Row>
      <Row label="Cost">
        {turn.includedInPlan ? costText(undefined, true) : costText(turn.costUsd, false)}
      </Row>
    </dl>
  );
}

/** The model and the effort it runs at, and the size against the window, at the top of the popover. */
function Heading({ view }: { readonly view: ConversationView }) {
  const runsOn = [view.model, view.effort && `${view.effort} effort`].filter(Boolean).join(', ');
  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-md font-bold text-ink">Context</h3>
        {view.percent !== undefined && (
          <span className="tabular text-md font-bold text-ink">{view.percent}%</span>
        )}
      </div>
      <p className="truncate text-xs text-dim" title={runsOn || undefined}>
        {runsOn || 'The model shows after the first reply'}
      </p>
      {view.used !== undefined && (
        <p className="tabular text-sm text-ink-2">
          {view.estimate && '≈ '}
          {view.used.toLocaleString()} tokens
          {view.window ? ` of ${short(view.window)}` : ", of a window this model doesn't name"}
        </p>
      )}
      {view.estimate && (
        <p className="text-xs text-dim">
          An estimate: Codex reports only each turn's total, so a turn with several model calls reads higher
          than the conversation is.
        </p>
      )}
    </div>
  );
}

/**
 * What the popover tells about the conversation: the model, what fills the window, the last turn, the conversation so
 * far (since its start or last Clear) and how many slash commands and skills the harness offers.
 */
export function ContextDetails({ view }: { readonly view: ConversationView }) {
  const { session } = view;
  return (
    <div className="grid gap-3">
      <Heading view={view} />
      <ContextFills view={view} />
      {view.lastTurn && (
        <Section title="Last turn">
          <LastTurn turn={view.lastTurn} />
        </Section>
      )}
      <Section title={session.afterClear ? 'Since the last Clear' : 'This conversation'}>
        <dl className="grid gap-1">
          <Row label="Turns">{session.turns}</Row>
          {session.turns > 0 && <Row label="Tokens">{short(session.tokens)}</Row>}
          {session.turns > 0 && <Row label="Cost">{costText(session.costUsd, session.onPlan)}</Row>}
          {session.since && <Row label="Began">{formatDateTime(session.since)}</Row>}
        </dl>
      </Section>
      {view.commands !== undefined && (
        <p className="text-xs text-dim">
          {count(view.commands, 'slash command or skill', 'slash commands and skills')} offered
        </p>
      )}
    </div>
  );
}
