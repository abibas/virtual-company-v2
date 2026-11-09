import type { ChatTurnWithEvents, TurnEvent } from '../../../api/types.ts';

/**
 * An agent's reply assembled from its turn's events (docs/harness.md, "Events"): text in order (consecutive pieces
 * joined, since the runner splits long text), each tool call with its result, notices where they came, and the usage
 * and the error at the end. Pure.
 */

type Of<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;

export type ReplyPart =
  | { readonly kind: 'text'; readonly key: string; readonly text: string }
  | {
      readonly kind: 'tool';
      readonly key: string;
      readonly name: string;
      readonly summary: string;
      readonly result: { readonly ok: boolean; readonly summary: string } | undefined;
    }
  | {
      readonly kind: 'notice';
      readonly key: string;
      readonly level: Of<'notice'>['level'];
      readonly message: string;
    };

export interface Reply {
  readonly parts: readonly ReplyPart[];
  readonly usage: Of<'usage'> | undefined;
  /** Why the turn failed, once: the runner's or the server's reason, else the result's error. */
  readonly error: string | undefined;
}

/** Adds one event to the parts being built (`tools` maps a tool id to its part's index). */
function addPart(parts: ReplyPart[], tools: Map<string, number>, event: TurnEvent, seq: number) {
  const key = String(seq);
  const last = parts.at(-1);
  if (event.type === 'text') {
    if (last?.kind === 'text') parts[parts.length - 1] = { ...last, text: last.text + event.text };
    else parts.push({ kind: 'text', key, text: event.text });
  } else if (event.type === 'tool') {
    tools.set(event.id, parts.length);
    parts.push({ kind: 'tool', key, name: event.name, summary: event.summary, result: undefined });
  } else if (event.type === 'tool_result') {
    const index = tools.get(event.id);
    const part = index === undefined ? undefined : parts[index];
    const result = { ok: event.ok, summary: event.summary };
    if (part?.kind === 'tool' && index !== undefined) parts[index] = { ...part, result };
    else parts.push({ kind: 'tool', key, name: 'Tool', summary: '', result });
  } else if (event.type === 'notice') {
    parts.push({ kind: 'notice', key, level: event.level, message: event.message });
  }
}

/** The reply of a turn, from its events, its status and its error. */
export function replyOf(turn: ChatTurnWithEvents): Reply {
  const parts: ReplyPart[] = [];
  const tools = new Map<string, number>();
  let usage: Of<'usage'> | undefined;
  let result: Of<'result'> | undefined;
  for (const { seq, event } of turn.events) {
    if (event.type === 'usage') usage = event;
    else if (event.type === 'result') result = event;
    else addPart(parts, tools, event, seq);
  }
  // A reply the parser gave only in its result (no text events) still shows.
  const replyText = result?.text ?? turn.resultText;
  if (replyText && !parts.some((part) => part.kind === 'text')) {
    parts.push({ kind: 'text', key: 'result', text: replyText });
  }
  const failed = turn.status === 'failed' || (result !== undefined && !result.ok);
  const error = failed ? (turn.error ?? result?.error ?? 'The turn failed.') : undefined;
  return { parts, usage, error };
}
