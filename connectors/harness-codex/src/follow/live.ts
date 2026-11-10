import { clipLine, clipMarked } from '@mwc/harness-core';
import { SUBAGENT_SUMMARY_MAX, SUBAGENT_TYPE_MAX, type TurnEvent } from '@mwc/shared/harness';
import { findRollout, type RolloutFs } from '../rollout.ts';
import { CODEX_AGENT_TYPE, type CollabState, putSubagent, type Subagent } from '../subagents.ts';
import { childLine } from './child.ts';
import { FileFollower, FOLLOW_READ_BYTES } from './file.ts';
import { isOwnTurn } from './lines.ts';
import { type Activity, parentLine, type SpawnCall } from './parent.ts';
import { type ChildAnswer, ChildSteps } from './steps.ts';

/**
 * Codex's subagents while its turn runs (docs/harness.md, "Codex subagents"): the agent's own session file and each
 * subagent's, followed as they grow (`file.ts`), polled by the parser's `tick` about once a second and once more as the
 * turn ends. The agent's file gives each subagent's start and moves (`parent.ts`, multi-agent v2, which `codex exec
 * --json` never prints); a subagent's own file gives its commands and messages as events nested under it and its
 * answer (`child.ts`, `steps.ts`), for every subagent in the parser's state, v1's collab ones too. One state for both
 * sources, keyed by the subagent's thread id, so a thread is one subagent whichever reported it. Bounded: at most
 * `FOLLOW_READ_BYTES` read from a file and `FOLLOW_ROUND_BYTES` from all of them per poll (the agent's first, then the
 * subagents' in the order they started; what is left waits for the next poll), `FOLLOWED_CHILDREN_MAX` subagents'
 * files, files made during the turn looked for in the newest `RECENT_DAYS` day folders only. Synchronous file calls,
 * no process.
 */

export { FOLLOW_READ_BYTES };
export const FOLLOW_ROUND_BYTES = 4 << 20;
export const FOLLOWED_CHILDREN_MAX = 16;
export const RECENT_DAYS = 2;
/** How many polls a subagent's file is looked for before it is given up. */
export const CHILD_SEARCHES_MAX = 30;
/** The spawn calls kept until an activity names them. */
export const SPAWN_CALLS_MAX = 64;

export interface LiveOptions {
  readonly fs: RolloutFs;
  /** The turn's `CODEX_HOME`. */
  readonly home: string;
  /** When the runner started the turn, in milliseconds: the turn gate (`lines.ts`). */
  readonly since: number;
}

interface Followed {
  file: FileFollower | undefined;
  misses: number;
  readonly steps: ChildSteps;
}

interface Budget {
  left: number;
}

const STATUS = {
  started: 'running',
  interacted: 'running',
  interrupted: 'interrupted',
  completed: 'done',
} as const;

/** A subagent's type from its path in the agent tree: `/root/sleep_sol` → `sleep_sol`. */
export function agentTypeOf(path: string): string {
  const name = path.replace(/^\/(root(\/|$))?/, '').trim();
  return name ? clipLine(name, SUBAGENT_TYPE_MAX) : CODEX_AGENT_TYPE;
}

/** `before` with the model and effort it lacks. */
const withModel = (before: Subagent, from: { model?: string; effort?: string }): Subagent => ({
  ...before,
  ...(before.model === undefined && from.model !== undefined ? { model: from.model } : {}),
  ...(before.effort === undefined && from.effort !== undefined ? { effort: from.effort } : {}),
});

export class LiveSubagents {
  readonly #o: LiveOptions;
  readonly #state: CollabState;
  #threadId: string | undefined;
  /** The agent's own file, and whether its lines read now are this turn's. */
  #parent: { readonly file: FileFollower; own: boolean } | undefined;
  readonly #children = new Map<string, Followed>();
  readonly #spawns = new Map<string, SpawnCall>();
  /** The thread each v2 spawn call started. */
  readonly #byCall = new Map<string, string>();
  /** The subagents v2's activities started: their own file's end of turn also ends them. */
  readonly #v2 = new Set<string>();
  #closed = false;

  constructor(options: LiveOptions, state: CollabState) {
    this.#o = options;
    this.#state = state;
  }

  /**
   * The turn's thread (`thread.started`): its file, when it is there already (a resumed thread, a fork), is followed
   * from its present end, so nothing of the turns before shows; a file made later is read from its start.
   */
  thread(id: string): void {
    if (this.#threadId !== undefined) return;
    this.#threadId = id;
    const { fs, home } = this.#o;
    const path = findRollout(fs, home, id);
    const size = path === undefined ? undefined : fs.readAt(path, 0, 0)?.size;
    if (path !== undefined && size !== undefined)
      this.#parent = { file: new FileFollower(fs, path, size), own: true };
  }

  /** What was written since the last poll, as events: the subagents first, then their own steps. */
  poll(): TurnEvent[] {
    if (this.#closed || this.#threadId === undefined) return [];
    const budget: Budget = { left: FOLLOW_ROUND_BYTES };
    const events = this.#readParent(this.#threadId, budget);
    this.#adopt();
    for (const [id, child] of this.#children) events.push(...this.#readChild(id, child, budget));
    return events;
  }

  /** The last poll, as the turn ends; nothing after it. */
  finish(): TurnEvent[] {
    const events = this.poll();
    this.#closed = true;
    return events;
  }

  #lines(file: FileFollower, budget: Budget): readonly string[] {
    const { lines, bytes } = file.read(Math.min(FOLLOW_READ_BYTES, budget.left));
    budget.left -= bytes;
    return lines;
  }

  #readParent(threadId: string, budget: Budget): TurnEvent[] {
    if (this.#parent === undefined) {
      const path = findRollout(this.#o.fs, this.#o.home, threadId, RECENT_DAYS);
      if (path === undefined) return [];
      // Made during the turn: from its start, the turn gate skipping any history copied into it.
      this.#parent = { file: new FileFollower(this.#o.fs, path, 0), own: false };
    }
    const parent = this.#parent;
    return this.#lines(parent.file, budget).flatMap((text) => {
      const line = parentLine(text);
      if (line === undefined) return [];
      if ('turnStarted' in line) {
        parent.own = isOwnTurn(line.turnStarted, this.#o.since);
        return [];
      }
      if (!parent.own) return [];
      return 'spawn' in line ? this.#spawn(line.spawn) : this.#activity(line.activity);
    });
  }

  /** An activity: a new subagent when it starts (or is given work), else its status. */
  #activity(activity: Activity): TurnEvent[] {
    const before = this.#state.subagents.get(activity.threadId);
    const status = STATUS[activity.kind];
    if (before !== undefined) return putSubagent(this.#state, { ...withModel(before, activity), status });
    // An earlier turn's subagent that ends now was not started here.
    if (status !== 'running') return [];
    const spawn = activity.id === undefined ? undefined : this.#spawns.get(activity.id);
    if (activity.id !== undefined) remember(this.#byCall, activity.id, activity.threadId);
    this.#v2.add(activity.threadId);
    // Its own file is followed: nothing to read of it when the turn ends.
    this.#state.read.add(activity.threadId);
    const subagent: Subagent = {
      id: activity.threadId,
      agentType: agentTypeOf(activity.path),
      description: spawn?.description ?? '',
      background: true,
      status,
    };
    return putSubagent(this.#state, withModel(withModel(subagent, activity), spawn ?? {}));
  }

  /** A spawn call: kept for its activity, or the description of the subagent its activity already started. */
  #spawn(call: SpawnCall): TurnEvent[] {
    remember(this.#spawns, call.callId, call);
    const id = this.#byCall.get(call.callId);
    const before = id === undefined ? undefined : this.#state.subagents.get(id);
    if (before === undefined || before.description !== '') return [];
    return putSubagent(this.#state, withModel({ ...before, description: call.description }, call));
  }

  /** Follows each subagent in the state, up to the cap. */
  #adopt(): void {
    for (const id of this.#state.subagents.keys()) {
      if (this.#children.size >= FOLLOWED_CHILDREN_MAX) return;
      if (!this.#children.has(id))
        this.#children.set(id, { file: undefined, misses: 0, steps: new ChildSteps(id, this.#o.since) });
    }
  }

  #readChild(id: string, child: Followed, budget: Budget): TurnEvent[] {
    if (child.file === undefined) {
      if (child.misses >= CHILD_SEARCHES_MAX) return [];
      const path = findRollout(this.#o.fs, this.#o.home, id, RECENT_DAYS);
      if (path === undefined) {
        child.misses += 1;
        return [];
      }
      child.file = new FileFollower(this.#o.fs, path, 0);
    }
    const events: TurnEvent[] = [];
    for (const text of this.#lines(child.file, budget)) {
      const line = childLine(text);
      if (line === undefined) continue;
      const { events: steps, ended } = child.steps.take(line);
      events.push(...steps);
      if (ended !== undefined) events.push(...this.#ended(id, ended));
    }
    return events;
  }

  /** A subagent's turn ended: its answer (or error) as its summary; a v2 one that still runs is done, or failed. */
  #ended(id: string, { answer, error }: ChildAnswer): TurnEvent[] {
    const before = this.#state.subagents.get(id) as Subagent;
    const text = error ?? answer;
    const status =
      this.#v2.has(id) && before.status === 'running' ? (error ? 'failed' : 'done') : before.status;
    const summary = text === undefined ? before.summary : clipMarked(text, SUBAGENT_SUMMARY_MAX);
    return putSubagent(this.#state, { ...before, status, ...(summary === undefined ? {} : { summary }) });
  }
}

/** Sets `key` in a map that keeps at most `SPAWN_CALLS_MAX` entries, the oldest going first. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= SPAWN_CALLS_MAX) map.delete(map.keys().next().value as string);
  map.set(key, value);
}
