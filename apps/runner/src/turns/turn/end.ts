import type { TurnEvent } from '@mwc/shared/harness';
import {
  TURN_STOP_KILL_MS,
  TURN_STOP_TERM_MS,
  type TurnEnd,
  type TurnRunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../../system/log.ts';
import type { KillGroup } from '../../system/process.ts';
import type { Timers } from '../../system/time.ts';
import { type ArtifactCollector, artifactFrames } from '../artifacts/collect.ts';
import type { AskBridge } from '../ask/bridge.ts';
import { STDERR_TAIL_BYTES } from '../lines.ts';
import { type PrivateLease, releaseLogin } from '../private-dir.ts';
import type { RunExit, RunMeta } from '../runs/folder.ts';
import type { ReadAt } from '../runs/journal.ts';
import type { Kept } from '../runs/kept.ts';
import type { TurnParts } from './parts.ts';

/**
 * How a turn ends and what its run folder records (S5.4): the stop ladder, the `turn.end` from the keeper's exit, a
 * stop, a start that failed and the harness's result; the task step's files before it; the end of stderr a failure
 * quotes; the meta a later runner takes the turn back from.
 */

/**
 * The stop ladder on the keeper's process group: SIGINT now, SIGTERM `TURN_STOP_TERM_MS` later, SIGKILL
 * `TURN_STOP_KILL_MS` after the SIGINT, each only while the keeper is still there (never a pid that may no longer be the
 * turn's); the timers, to clear once it ended. Nothing without a keeper.
 */
export function walkLadder(kept: Kept | undefined, killGroup: KillGroup, timers: Timers): unknown[] {
  const pid = kept?.pid;
  if (kept === undefined || pid === undefined) return [];
  const signal = (name: NodeJS.Signals) => {
    if (kept.alive) killGroup(pid, name);
  };
  signal('SIGINT');
  return [
    timers.setTimeout(() => signal('SIGTERM'), TURN_STOP_TERM_MS),
    timers.setTimeout(() => signal('SIGKILL'), TURN_STOP_KILL_MS),
  ];
}

/** The log line of a login a harness rewrote into something that is not one (its text is never logged). */
export const INVALID_LOGIN = 'the harness rewrote its login into something that is not one; not sent back';

/** Why the process failed to start (the keeper's, or the harness's as the keeper wrote it), as `turn.end` says it. */
export function startFailure(spawnError: string | undefined, exit: RunExit | undefined): string | undefined {
  const error = spawnError ?? exit?.error;
  return error === undefined ? undefined : `spawn_failed: ${error}`;
}

/**
 * The turn's end: `spawn_failed`, else `stopped` after a stop, else `process_lost` when the keeper ended without its
 * exit recorded (killed with the harness while nobody stopped it), else `session_missing: <the harness's line>` when
 * the conversation it resumed is not on this machine (`missingSession`); `ok` is the result's when nothing failed.
 */
export function endFrame(turn: {
  readonly turnId: string;
  readonly exit: RunExit | undefined;
  readonly spawnError: string | undefined;
  readonly stopping: boolean;
  readonly result: Extract<TurnEvent, { type: 'result' }> | undefined;
  readonly authJson: string | undefined;
  readonly sessionMissing?: string | undefined;
}): TurnEnd {
  const lost = turn.exit === undefined && !turn.stopping ? 'process_lost' : undefined;
  const missing = turn.sessionMissing === undefined ? undefined : `session_missing: ${turn.sessionMissing}`;
  const error = startFailure(turn.spawnError, turn.exit) ?? (turn.stopping ? 'stopped' : (lost ?? missing));
  return {
    type: 'turn.end',
    turnId: turn.turnId,
    ok: error === undefined && turn.result?.ok === true,
    exitCode: turn.exit?.code ?? null,
    ...(error === undefined ? {} : { error }),
    ...(turn.authJson === undefined ? {} : { authJson: turn.authJson }),
  };
}

/** The Codex login the process rewrote, when it is still a login the server can take (its folder released); never logged. */
export function rewrittenLogin(
  lease: PrivateLease | undefined,
  log: Log,
  turnId: string,
): string | undefined {
  const login = releaseLogin(lease);
  if (login !== 'invalid') return login;
  log.warn(INVALID_LOGIN, { turnId });
  return undefined;
}

/** A task step's outputs: the files new or changed in its folder, then what was left out (logged, never thrown). */
export function sendArtifacts(
  collector: ArtifactCollector | undefined,
  turnId: string,
  send: (frame: TurnRunnerFrame) => boolean,
  log: Log,
): void {
  if (collector === undefined) return;
  try {
    const collected = collector.collect();
    for (const frame of artifactFrames(turnId, collected)) send(frame);
    log.info('turn outputs collected', {
      turnId,
      files: collected.files.length,
      skipped: collected.skipped.length,
    });
  } catch (error) {
    log.warn('turn outputs could not be collected', {
      turnId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The harness's own line saying the conversation the turn resumed is not on this machine (docs/harness.md "A lost
 * conversation"), when the process started, exited with a failure and gave no good result, and the driver finds its
 * words in the end of stderr or in a failing result the output gave; undefined otherwise.
 */
export function missingSession(
  parts: Pick<TurnParts, 'sessionMissing' | 'folder'>,
  readAt: ReadAt,
  turn: {
    readonly exit: RunExit | undefined;
    readonly spawnError: string | undefined;
    readonly result: Extract<TurnEvent, { type: 'result' }> | undefined;
  },
): string | undefined {
  const { exit, result } = turn;
  if (parts.sessionMissing === undefined || turn.spawnError !== undefined) return undefined;
  if (exit === undefined || exit.code === 0 || exit.error !== undefined || result?.ok === true)
    return undefined;
  const stderr = stderrTail(readAt, parts.folder.path('err'));
  return parts.sessionMissing([stderr, result?.error ?? '', result?.text ?? ''].join('\n'));
}

/** The last `STDERR_TAIL_BYTES` of a file (the harness's stderr), as text. */
export function stderrTail(readAt: ReadAt, path: string): string {
  const size = readAt(path, 0, 0)?.size ?? 0;
  const tail = readAt(path, Math.max(0, size - STDERR_TAIL_BYTES), STDERR_TAIL_BYTES);
  return tail === undefined ? '' : Buffer.from(tail.data).toString('utf8');
}

/** The meta of a fresh turn: what it is, its keeper's pid, its private files' names and hashes, its outputs and socket. */
export function metaOf(
  turnId: string,
  turn: {
    readonly harness: RunMeta['harness'];
    readonly cwd: string;
    readonly stdinOpen: boolean;
    readonly lease: PrivateLease | undefined;
    readonly artifacts?: ArtifactCollector | undefined;
    readonly bridge?: AskBridge | undefined;
    readonly afterSeq?: number | undefined;
  },
  pid: number,
  startedAt: number,
): RunMeta {
  const { lease, bridge } = turn;
  const snapshot = turn.artifacts?.snapshot();
  const after = turn.afterSeq ?? 0;
  return {
    v: 1,
    turnId,
    harness: turn.harness,
    cwd: turn.cwd,
    pid,
    startedAt,
    stdinOpen: turn.stdinOpen,
    privateDir: lease === undefined ? null : { path: lease.path, ...lease.record() },
    artifacts:
      snapshot === undefined ? null : { root: snapshot.root, before: snapshot.before.map((e) => [...e]) },
    ask: bridge === undefined ? null : { dir: bridge.dir, tokenSha256: bridge.tokenSha256 },
    ...(after > 0 ? { afterSeq: after } : {}),
  };
}
