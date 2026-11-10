import { clipLine, clipMarked, clipTail } from '@mwc/harness-core';
import {
  SUBAGENT_SUMMARY_MAX,
  TOOL_RESULT_SUMMARY_MAX,
  TOOL_SUMMARY_MAX,
  type TurnEvent,
} from '@mwc/shared/harness';
import type { ChildLine } from './child.ts';
import { isOwnTurn } from './lines.ts';

/**
 * One subagent's own work as the events nested under it (docs/harness.md, "Codex subagents"): each event names the
 * subagent as its `parentId`, as a Claude subagent's do. A command is a `tool` named `command` when its call starts (or
 * when it ends, for one that never showed a call) and a `tool_result` when it ends; a message is `text`. Only its own
 * turns count (`lines.ts`, the turn gate: never the root thread's turns it was forked with), and at most
 * `CHILD_STEPS_MAX` commands and messages are shown per subagent (a shown command's result still comes); its turn's
 * end is handed back as its answer, never as an event.
 */

/** The most commands and messages shown under one subagent; past them only its card moves. */
export const CHILD_STEPS_MAX = 200;

/** How a subagent's turn ended: its last message, or its error. */
export interface ChildAnswer {
  readonly answer: string | undefined;
  readonly error: string | undefined;
}

/** What a line gave: the nested events, and its turn's end when the line was one. */
export interface ChildTake {
  readonly events: readonly TurnEvent[];
  readonly ended?: ChildAnswer;
}

const NONE: ChildTake = { events: [] };

/** A legacy call's output while its process still runs (unified exec yields after a while): not its end yet. */
const STILL_RUNNING = /^Process running with session ID/m;
const EXIT_CODE = /(?:Process exited with code|Exit code:)\s*(-?\d+)/;

/** A legacy call's output as a result: `exit 1: <the end of its output>`, or `done` when it names no exit code. */
function outputResult(output: string): { ok: boolean; summary: string } | undefined {
  if (STILL_RUNNING.test(output)) return undefined;
  const code = EXIT_CODE.exec(output)?.[1];
  const exit = code === undefined ? undefined : Number(code);
  const head = exit === undefined ? 'done' : `exit ${exit}`;
  const body = (output.split(/^Output:\s*$/m)[1] ?? (exit === undefined ? output : '')).trim();
  const summary =
    body === '' ? head : `${head}: ${clipTail(body, TOOL_RESULT_SUMMARY_MAX - head.length - 2)}`;
  return { ok: (exit ?? 0) === 0, summary };
}

export class ChildSteps {
  readonly #id: string;
  readonly #since: number;
  /** Whether its file is a paginated one (its commands' ends are items, not only outputs). */
  #paginated = false;
  /** Whether the lines read now are its own turn's, not history it was forked with. */
  #own = false;
  /** Its commands shown, by call id: whether their result was given. */
  readonly #calls = new Map<string, boolean>();
  #count = 0;

  /** `id`: the subagent's (its thread id); `since`: when the runner started the turn, in milliseconds. */
  constructor(id: string, since: number) {
    this.#id = id;
    this.#since = since;
  }

  take(line: ChildLine): ChildTake {
    if (line.kind === 'meta') this.#paginated = line.paginated;
    else if (line.kind === 'turn') this.#own = !line.root && isOwnTurn(line.startedAt, this.#since);
    else if (!this.#own) return NONE;
    else if (line.kind === 'end') return { events: [], ended: { answer: line.answer, error: line.error } };
    else return { events: this.#steps(line) };
    return NONE;
  }

  #steps(line: Exclude<ChildLine, { kind: 'meta' | 'turn' | 'end' }>): TurnEvent[] {
    if (line.kind === 'message') {
      const text = clipMarked(line.text, SUBAGENT_SUMMARY_MAX);
      return this.#room() ? this.#add({ type: 'text', text, parentId: this.#id }) : [];
    }
    if (line.kind === 'call')
      return this.#calls.has(line.callId) ? [] : this.#tool(line.callId, line.command);
    if (line.kind === 'done') {
      const shown = this.#calls.has(line.callId) ? [] : this.#tool(line.callId, line.command ?? '');
      return [...shown, ...this.#result(line.callId, line.ok, line.summary)];
    }
    if (this.#paginated) return [];
    const result = outputResult(line.output);
    return result === undefined ? [] : this.#result(line.callId, result.ok, result.summary);
  }

  /** A command shown as it starts; nothing past the cap. */
  #tool(callId: string, command: string): TurnEvent[] {
    const id = this.#eventId(callId);
    if (id === undefined || !this.#room()) return [];
    this.#calls.set(callId, false);
    const summary = clipLine(command, TOOL_SUMMARY_MAX);
    return this.#add({ type: 'tool', id, name: 'command', summary, parentId: this.#id });
  }

  /** A shown command's result, once. */
  #result(callId: string, ok: boolean, summary: string): TurnEvent[] {
    const id = this.#eventId(callId);
    if (id === undefined || this.#calls.get(callId) !== false) return [];
    this.#calls.set(callId, true);
    return [{ type: 'tool_result', id, ok, summary, parentId: this.#id }];
  }

  /** A call's event id, unique across the subagents: `<thread id>:<call id>`, at most 200 characters. */
  #eventId(callId: string): string | undefined {
    const id = `${this.#id}:${callId}`;
    return id.length <= 200 ? id : undefined;
  }

  /** Whether one more command or message may show. */
  #room(): boolean {
    return this.#count < CHILD_STEPS_MAX;
  }

  #add(step: TurnEvent): TurnEvent[] {
    this.#count += 1;
    return [step];
  }
}
