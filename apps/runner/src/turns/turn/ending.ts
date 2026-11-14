import { rmSync } from 'node:fs';
import type { RunExit, RunMeta } from '../runs/folder.ts';
import { endFrame, missingSession, rewrittenLogin, sendArtifacts, startFailure, stderrTail } from './end.ts';
import type { TurnEvents } from './events.ts';
import type { TurnOutput } from './output.ts';
import type { TurnDeps, TurnParts } from './parts.ts';

/**
 * How a turn's process (`../turn.ts`) ended and what the server is told of it (S5.4, `end.ts`): the keeper's exit or
 * why it never started, the rest of the output closed with the failure's words, then the task step's files and
 * `turn.end`, again after a reconnect until the server acknowledges it (the Codex login the process rewrote is read
 * once), and the turn's files gone once it is done with. A conversation it resumed that is not here ends it
 * `session_missing`, with no failing result.
 */
export class TurnEnding {
  /** The keeper's exit as the run folder recorded it; undefined until the process ended, or when it was lost. */
  exit: RunExit | undefined;
  /** Why the keeper could not start. */
  spawnError: string | undefined;
  readonly #turnId: string;
  readonly #parts: TurnParts;
  readonly #deps: TurnDeps;
  readonly #output: TurnOutput;
  readonly #events: TurnEvents;
  #login: { readonly authJson: string | undefined } | undefined;

  constructor(
    turnId: string,
    parts: TurnParts,
    deps: TurnDeps,
    wired: { readonly output: TurnOutput; readonly events: TurnEvents },
  ) {
    this.#turnId = turnId;
    this.#parts = parts;
    this.#deps = deps;
    this.#output = wired.output;
    this.#events = wired.events;
  }

  /** The keeper ended: its exit, the rest of the output and the parser's last events, the result closed. */
  close(): void {
    const { folder } = this.#parts;
    this.exit = folder.exit();
    const detail = startFailure(this.spawnError, this.exit) ?? stderrTail(this.#deps.readAt, folder.path('err'));
    this.#output.drain();
    // A conversation that is not here gives no failing result: the server starts the turn afresh instead.
    if (this.#missing() === undefined) this.#output.close(this.exit?.code ?? null, detail);
  }

  /** The task step's files and `turn.end` (`stopping`: the turn was stopped). */
  deliver(stopping: boolean): void {
    const turnId = this.#turnId;
    const { send, log } = this.#deps;
    sendArtifacts(this.#parts.artifacts, turnId, send, log);
    this.#login ??= { authJson: rewrittenLogin(this.#parts.lease, log, turnId) };
    const end = endFrame({
      turnId,
      exit: this.exit,
      spawnError: this.spawnError,
      stopping,
      result: this.#output.result,
      authJson: this.#login.authJson,
      sessionMissing: this.#missing(),
    });
    send(end);
    const { ok, exitCode, error } = end;
    log.info('turn ended', { turnId, ok, exitCode, error, events: this.#events.lastSeq });
  }

  /** The turn is done with (its end acknowledged, or the turn forgotten): its private files and run folder go. */
  remove(meta: RunMeta | undefined): void {
    this.#parts.lease?.release();
    // A question socket's folder an earlier runner let go of (its tool's file holds the token) goes with the turn.
    if (meta?.ask) rmSync(meta.ask.dir, { recursive: true, force: true });
    this.#parts.folder.remove();
  }

  /** The harness's line saying the conversation it resumed is not here, read from its run folder (`missingSession`). */
  #missing(): string | undefined {
    const ended = { exit: this.exit, spawnError: this.spawnError, result: this.#output.result };
    return missingSession(this.#parts, this.#deps.readAt, ended);
  }
}
