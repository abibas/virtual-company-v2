import type { TurnToolResult } from '@mwc/shared/runner-protocol';
import type { TurnInput } from './input.ts';
import type { RunMeta } from './runs/folder.ts';
import type { Kept } from './runs/kept.ts';
import { metaOf } from './turn/end.ts';
import { TurnEnding } from './turn/ending.ts';
import { logState, type TurnEvents } from './turn/events.ts';
import { HeldKeeper, spawnTurnKeeper } from './turn/held.ts';
import type { TurnOutput } from './turn/output.ts';
import { type TurnDeps, type TurnLaunch, type TurnParts, wireTurn } from './turn/parts.ts';
import { TOOL_ENDING, TOOL_LOST, type TurnToolCalls } from './turn/tools.ts';

export { INVALID_LOGIN } from './turn/end.ts';
export { ASK_ENDING, ASK_OFFLINE } from './turn/events.ts';
export { JOURNAL_POLL_MS } from './turn/held.ts';
export type { TurnDeps, TurnLaunch, TurnParts } from './turn/parts.ts';
export { TOOL_ENDING, TOOL_LOST, TOOL_NO_ANSWER, TOOL_OFFLINE, TOOL_REPLY_MS } from './turn/tools.ts';

/**
 * One chat turn's process (docs/harness.md, "How a turn runs" and "Surviving restarts", S5.4). The runner starts its
 * keeper (`runs/keeper.ts`) in the turn's run folder, which starts the harness with its output in files; it holds the
 * keeper (`turn/held.ts`) and reads that output every `JOURNAL_POLL_MS` through the driver's parser into numbered
 * events, each kept in the run folder before it is sent (`turn/events.ts`), and the prompt goes to the harness's stdin
 * through the keeper, which keeps it open for the person's messages while the turn runs (`input.ts`). The turn outlives
 * the runner: `release` lets go of it (the runner stops or restarts) and a later runner takes it back from its run
 * folder (`resume`), reading the output again up to where its log got; a dropped link only holds its frames back until
 * the server says where to resume (`attach`). When the keeper ends: the parser's last events, then the task step's
 * files and `turn.end` once the turn is attached (`turn/ending.ts`: the Codex login the process rewrote goes back as
 * `authJson`, a conversation it resumed that is not here ends it `session_missing`); the run folder goes when the
 * server acknowledges the end, and a start's `afterSeq` numbers its events after the server's. `stop` walks the stop
 * ladder on the keeper's process group (`turn/end.ts`, `walkLadder`). The agent's calls of the agents' tools (S6a) go
 * to the server and back through `turn/tools.ts`; a call still waiting when the turn ends, is let go of or loses its
 * link is answered that it may not have taken effect.
 */

export class TurnProcess {
  readonly turnId: string;
  /** Resolves once its process ended and its end was handled (sent, or waiting for the link). */
  readonly done: Promise<void>;
  readonly #deps: TurnDeps;
  readonly #parts: TurnParts;
  readonly #events: TurnEvents;
  readonly #input: TurnInput;
  readonly #output: TurnOutput;
  readonly #tools: TurnToolCalls;
  readonly #keeper: HeldKeeper;
  readonly #end: TurnEnding;
  readonly #resolve: () => void;
  #meta: RunMeta | undefined;
  #stopping = false;
  #forgotten = false;
  #ended = false;

  constructor(turnId: string, parts: TurnParts, deps: TurnDeps) {
    this.turnId = turnId;
    this.#parts = parts;
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.done = promise;
    this.#resolve = resolve;
    this.#keeper = new HeldKeeper(deps);
    const wired = wireTurn(turnId, parts, deps, this.#keeper.stdin, () => !this.#ended && !this.#stopping);
    this.#events = wired.events;
    this.#input = wired.input;
    this.#output = wired.output;
    this.#tools = wired.tools;
    this.#end = new TurnEnding(turnId, parts, deps, wired);
    parts.bridge?.bind({
      ask: (questions) => {
        // The output so far first: the events before the question are numbered before it.
        if (!this.#ended) this.#output.read();
        return this.#events.ask(questions, this.#ended || this.#stopping);
      },
      tool: (tool, input) => this.#tools.call(tool, input),
    });
  }

  /** True while its process runs. */
  get running(): boolean {
    return !this.#ended;
  }

  /** What a hello says of it: its last event's number and whether its process ended. */
  get held() {
    return { turnId: this.turnId, lastSeq: this.#events.lastSeq, ended: this.#ended };
  }

  /** Starts a fresh turn's keeper; throws when it cannot even be spawned (the caller refuses the turn). */
  start(launch: TurnLaunch): void {
    const { process } = launch;
    const afterSeq = launch.afterSeq ?? 0;
    this.#events.resumeAfter(afterSeq);
    const kept = spawnTurnKeeper(this.#deps.spawn, launch, this.#parts);
    if (kept.pid !== undefined)
      this.#writeMeta(metaOf(this.turnId, { ...this.#parts, afterSeq }, kept.pid, launch.startedAt));
    this.#hold(kept);
    this.#input.begin(process.stdin);
    this.#output.push(process.notices);
    this.#deps.log.info('turn started', { turnId: this.turnId, command: process.command, pid: kept.pid });
  }

  /**
   * Takes back a turn an earlier runner started (its run folder's `meta`), its keeper found again or gone: its log says
   * how far the output was read and numbered, and the output is read again up to there, then goes on. It is not
   * attached until the server says where to resume.
   */
  resume(meta: RunMeta, kept: Kept | undefined): void {
    this.#meta = meta;
    this.#stopping = meta.stopping === true;
    this.#events.detach();
    const { folder } = this.#parts;
    const log = logState(folder.events());
    this.#events.resumeAfter(Math.max(log.lastSeq, meta.afterSeq ?? 0));
    this.#input.restore(folder.inputs());
    this.#deps.log.info('turn taken back', {
      turnId: this.turnId,
      lastSeq: log.lastSeq,
      live: kept !== undefined,
    });
    if (log.finished) {
      kept?.release();
      this.#output.result = log.result;
      this.#end.exit = folder.exit();
      this.#ended = true;
      this.#resolve();
      return;
    }
    this.#output.replay(log.offset);
    if (kept === undefined) {
      this.#gone();
      return;
    }
    this.#hold(kept);
    if (this.#stopping) this.#keeper.walkLadder();
  }

  /** The link dropped: its frames wait in the run folder; a tool's call waiting for the server gets no answer now. */
  detach(): void {
    this.#events.detach();
    this.#tools.closeAll(TOOL_LOST);
  }

  /** The server's answer to a tool's call (`turn.tool.result`); false when no call of that id waits. */
  toolResult(frame: TurnToolResult): boolean {
    return this.#tools.result(frame);
  }

  /** The server said where to resume: what it has not stored goes now, then the end once the process ended. */
  attach(lastSeq: number): void {
    const resent = this.#events.resend(lastSeq);
    this.#deps.log.info('turn resumed', { turnId: this.turnId, lastSeq, resent });
    if (this.#ended) this.#deliver();
  }

  /** The person's message for the running turn (`turn.input`); false when it takes none now (the server starts it next). */
  input(inputId: string, text: string): boolean {
    const taken = !this.#ended && !this.#stopping && this.#input.send(inputId, text);
    if (!taken) this.#deps.log.info('turn.input not taken; dropped', { turnId: this.turnId, inputId });
    return taken;
  }

  /** Ends it by the stop ladder (once). */
  stop(): Promise<void> {
    if (this.#stopping || this.#ended) return this.done;
    this.#stopping = true;
    if (this.#meta !== undefined) this.#writeMeta({ ...this.#meta, stopping: true });
    this.#input.close('stopping');
    this.#keeper.walkLadder();
    return this.done;
  }

  /** The server no longer has the turn: it is stopped, sends nothing more, and its folder goes once it ended. */
  forget(): void {
    this.#forgotten = true;
    this.#events.detach();
    this.#tools.closeAll(TOOL_ENDING);
    if (this.#ended) this.#done();
    else void this.stop();
  }

  /** The runner stops or restarts: it lets go of the turn, which runs on for the next runner; nothing is sent. */
  release(): void {
    this.#events.detach();
    this.#tools.closeAll(TOOL_LOST);
    this.#keeper.stopTimers();
    this.#keeper.release();
    this.#parts.bridge?.release();
  }

  /** The server recorded the turn's end: its private files and run folder go. */
  acknowledged(): void {
    if (this.#ended) this.#done();
  }

  #hold(kept: Kept): void {
    this.#keeper.hold(kept, this.#output, (error) => {
      this.#end.spawnError = error;
      this.#gone();
    });
  }

  /** The keeper ended (or was never there): the rest of the output and the parser's last events, then the end. */
  #gone(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#keeper.stopTimers();
    this.#tools.closeAll(TOOL_ENDING);
    this.#parts.bridge?.close();
    this.#end.close();
    this.#input.close();
    this.#events.finish();
    this.#deps.ended(this.turnId);
    if (this.#forgotten) this.#done();
    else if (this.#events.attached) this.#deliver();
    this.#resolve();
  }

  /** The task step's files and `turn.end`; again after a reconnect until the server acknowledges it. */
  #deliver(): void {
    if (!this.#forgotten) this.#end.deliver(this.#stopping);
  }

  #done(): void {
    this.#end.remove(this.#meta);
    this.#deps.done(this.turnId);
  }

  #writeMeta(meta: RunMeta): void {
    this.#meta = meta;
    this.#parts.folder.writeMeta(meta);
  }
}
