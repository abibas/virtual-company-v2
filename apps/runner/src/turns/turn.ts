import { rmSync } from 'node:fs';
import { PARSER_TICK_MS } from '@mwc/harness-core';
import { every } from '../system/time.ts';
import type { TurnInput } from './input.ts';
import type { RunExit, RunMeta } from './runs/folder.ts';
import { type Kept, spawnKeeper } from './runs/kept.ts';
import {
  endFrame,
  metaOf,
  rewrittenLogin,
  sendArtifacts,
  startFailure,
  stderrTail,
  walkLadder,
} from './turn/end.ts';
import { logState, type TurnEvents } from './turn/events.ts';
import type { TurnOutput } from './turn/output.ts';
import { type TurnDeps, type TurnLaunch, type TurnParts, wireTurn } from './turn/parts.ts';

export { INVALID_LOGIN } from './turn/end.ts';
export { ASK_ENDING, ASK_OFFLINE } from './turn/events.ts';
export type { TurnDeps, TurnLaunch, TurnParts } from './turn/parts.ts';

/**
 * One chat turn's process (docs/harness.md, "How a turn runs" and "Surviving restarts", S5.4). The runner starts its
 * keeper (`runs/keeper.ts`) in the turn's run folder, which starts the harness with its output in files; the runner
 * reads that output every `JOURNAL_POLL_MS` through the driver's parser into numbered events, each kept in the run
 * folder before it is sent (`turn/events.ts`), and the prompt goes to the harness's stdin through the keeper, which
 * keeps it open for the person's messages while the turn runs (`input.ts`). The turn outlives the runner: `release`
 * lets go of it (the runner stops or restarts) and a later runner takes it back from its run folder (`resume`), reading
 * the output again up to where its log got; a dropped link only holds its frames back until the server says where to
 * resume (`attach`). When the keeper ends: the parser's last events, then the task step's files and `turn.end` once the
 * turn is attached (the Codex login the process rewrote goes back as `authJson`); the run folder goes when the server
 * acknowledges the end. `stop` walks the ladder on the keeper's process group: SIGINT, SIGTERM 10 s later, SIGKILL 20 s
 * after the SIGINT, each only while the keeper is still there (never a pid that may no longer be the turn's).
 */

/** How often a live turn's output is read. */
export const JOURNAL_POLL_MS = 100;

export class TurnProcess {
  readonly turnId: string;
  /** Resolves once its process ended and its end was handled (sent, or waiting for the link). */
  readonly done: Promise<void>;
  readonly #deps: TurnDeps;
  readonly #parts: TurnParts;
  readonly #events: TurnEvents;
  readonly #input: TurnInput;
  readonly #output: TurnOutput;
  readonly #resolve: () => void;
  #meta: RunMeta | undefined;
  #kept: Kept | undefined;
  #exit: RunExit | undefined;
  #spawnError: string | undefined;
  #stopping = false;
  #forgotten = false;
  #ladder: unknown[] = [];
  #timers: (() => void)[] = [];
  #ended = false;
  #login: { readonly authJson: string | undefined } | undefined;

  constructor(turnId: string, parts: TurnParts, deps: TurnDeps) {
    this.turnId = turnId;
    this.#parts = parts;
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.done = promise;
    this.#resolve = resolve;
    const stdin = { write: (text: string) => this.#kept?.write(text) ?? false, end: () => this.#kept?.end() };
    const wired = wireTurn(turnId, parts, deps, stdin);
    this.#events = wired.events;
    this.#input = wired.input;
    this.#output = wired.output;
    parts.bridge?.bind((questions) => {
      // The output so far first: the events before the question are numbered before it.
      if (!this.#ended) this.#output.read();
      return this.#events.ask(questions, this.#ended || this.#stopping);
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
    const { folder, cwd } = this.#parts;
    const kept = spawnKeeper(this.#deps.spawn, launch.keeper, {
      dir: folder.dir,
      command: process.command,
      args: process.args,
      cwd,
      env: launch.env,
    });
    if (kept.pid !== undefined) this.#writeMeta(metaOf(this.turnId, this.#parts, kept.pid, launch.startedAt));
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
    this.#events.resumeAfter(log.lastSeq);
    this.#input.restore(folder.inputs());
    this.#deps.log.info('turn taken back', {
      turnId: this.turnId,
      lastSeq: log.lastSeq,
      live: kept !== undefined,
    });
    if (log.finished) {
      kept?.release();
      this.#output.result = log.result;
      this.#exit = folder.exit();
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
    if (this.#stopping) this.#walkLadder();
  }

  /** The link dropped: its frames wait in the run folder. */
  detach(): void {
    this.#events.detach();
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
    this.#walkLadder();
    return this.done;
  }

  /** The server no longer has the turn: it is stopped, sends nothing more, and its folder goes once it ended. */
  forget(): void {
    this.#forgotten = true;
    this.#events.detach();
    if (this.#ended) this.#done();
    else void this.stop();
  }

  /** The runner stops or restarts: it lets go of the turn, which runs on for the next runner; nothing is sent. */
  release(): void {
    this.#events.detach();
    this.#stopTimers();
    this.#kept?.release();
    this.#parts.bridge?.release();
  }

  /** The server recorded the turn's end: its private files and run folder go. */
  acknowledged(): void {
    if (this.#ended) this.#done();
  }

  #hold(kept: Kept): void {
    this.#kept = kept;
    kept.gone((error) => {
      this.#spawnError = error;
      this.#gone();
    });
    this.#timers.push(every(this.#deps.timers, JOURNAL_POLL_MS, () => this.#output.read()));
    if (this.#output.ticks)
      this.#timers.push(every(this.#deps.timers, PARSER_TICK_MS, () => this.#output.tick()));
  }

  #walkLadder(): void {
    this.#ladder = walkLadder(this.#kept, this.#deps.killGroup, this.#deps.timers);
  }

  /** The keeper ended (or was never there): the rest of the output and the parser's last events, then the end. */
  #gone(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#stopTimers();
    this.#parts.bridge?.close();
    this.#exit = this.#parts.folder.exit();
    const detail =
      startFailure(this.#spawnError, this.#exit) ??
      stderrTail(this.#deps.readAt, this.#parts.folder.path('err'));
    this.#output.end(this.#exit?.code ?? null, detail);
    this.#input.close();
    this.#events.finish();
    this.#deps.ended(this.turnId);
    if (this.#forgotten) this.#done();
    else if (this.#events.attached) this.#deliver();
    this.#resolve();
  }

  /** The task step's files and `turn.end`; again after a reconnect until the server acknowledges it. */
  #deliver(): void {
    if (this.#forgotten) return;
    const { turnId } = this;
    const { send, log } = this.#deps;
    sendArtifacts(this.#parts.artifacts, turnId, send, log);
    this.#login ??= { authJson: rewrittenLogin(this.#parts.lease, log, turnId) };
    const end = endFrame({
      turnId,
      exit: this.#exit,
      spawnError: this.#spawnError,
      stopping: this.#stopping,
      result: this.#output.result,
      authJson: this.#login.authJson,
    });
    send(end);
    const { ok, exitCode, error } = end;
    log.info('turn ended', { turnId, ok, exitCode, error, events: this.#events.lastSeq });
  }

  #done(): void {
    this.#parts.lease?.release();
    // A question socket's folder an earlier runner let go of (its tool's file holds the token) goes with the turn.
    if (this.#meta?.ask) rmSync(this.#meta.ask.dir, { recursive: true, force: true });
    this.#parts.folder.remove();
    this.#deps.done(this.turnId);
  }

  #stopTimers(): void {
    for (const stop of this.#timers.splice(0)) stop();
    for (const timer of this.#ladder.splice(0)) this.#deps.timers.clearTimeout(timer);
  }

  #writeMeta(meta: RunMeta): void {
    this.#meta = meta;
    this.#parts.folder.writeMeta(meta);
  }
}
