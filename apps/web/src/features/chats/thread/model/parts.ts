import type { TurnEvent } from '../../../../api/types.ts';
import type { TurnQuestion } from '../question/question-model.ts';

/** The pieces a turn's thread shows (S5.2), built by `turn-model.ts`. Types only. */

type Of<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;

/** One tool call with its result once it came; `at` is when it started. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly at: string;
  readonly result: { readonly ok: boolean; readonly summary: string } | undefined;
}

export type Part =
  | { readonly kind: 'text'; readonly key: string; readonly text: string }
  /** `ms`: from the thinking to what came next; undefined while it is the last thing. */
  | {
      readonly kind: 'thinking';
      readonly key: string;
      readonly text: string;
      readonly ms: number | undefined;
    }
  /** Consecutive tool calls, shown as one row. */
  | { readonly kind: 'tools'; readonly key: string; readonly calls: readonly ToolCall[] }
  | {
      readonly kind: 'notice';
      readonly key: string;
      readonly level: Of<'notice'>['level'];
      readonly message: string;
    }
  /** A subagent's block, where its Agent call came. */
  | { readonly kind: 'subagent'; readonly key: string; readonly id: string }
  /** A compaction during a turn (Claude Code's own, near the end of the window). */
  | { readonly kind: 'compact'; readonly key: string; readonly event: Of<'compact'> };

/** A subagent's latest state, when it started and ended, and how many steps (tool calls) it made. */
export interface SubagentState {
  readonly event: Of<'subagent'>;
  readonly startedAt: string;
  readonly endedAt: string | undefined;
  readonly steps: number;
}

/** What the agent is doing now: the latest event's meaning, and the subagent it belongs to. */
export type Activity =
  | { readonly kind: 'starting' }
  | { readonly kind: 'thinking' }
  | { readonly kind: 'writing' }
  /** A subagent's own report of what it does now. */
  | { readonly kind: 'step'; readonly text: string }
  | { readonly kind: 'tool'; readonly call: ToolCall; readonly agentType: string | undefined };

export interface CurrentActivity {
  readonly activity: Activity;
  /** The subagent the latest event came from; undefined for the main agent. */
  readonly subagent: SubagentState | undefined;
  /** The event's number, so a change of action can show as one. */
  readonly seq: number;
}

export interface TurnModel {
  /** The main agent's parts, in order. */
  readonly parts: readonly Part[];
  /** Each subagent's own parts, by its id. */
  readonly children: ReadonlyMap<string, readonly Part[]>;
  readonly subagents: ReadonlyMap<string, SubagentState>;
  /** The main agent's latest to-do list. */
  readonly todo: Of<'todo'>['items'] | undefined;
  readonly init: Of<'init'> | undefined;
  /** The turn's last compaction. */
  readonly compact: Of<'compact'> | undefined;
  readonly usage: Of<'usage'> | undefined;
  readonly durationMs: number | undefined;
  /** The main agent's tool calls, in order (the action history and the counts). */
  readonly calls: readonly ToolCall[];
  readonly current: CurrentActivity;
  /** The agent's latest question in this turn, with the person's answer once given (S5.2 step 4). */
  readonly question: TurnQuestion | undefined;
  /** The reply as text, for Copy: the main agent's text, else the result's. */
  readonly replyText: string;
  /** Why the turn failed, once. */
  readonly error: string | undefined;
}
