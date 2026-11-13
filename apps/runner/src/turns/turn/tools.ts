import { randomUUID } from 'node:crypto';
import type { TurnArtifact, TurnTool, TurnToolResult } from '@mwc/shared/runner-protocol';
import type { Log } from '../../system/log.ts';
import type { Timers } from '../../system/time.ts';
import { type ArtifactCollector, fileFrames } from '../artifacts/collect.ts';
import type { AskReply } from '../ask/tool.ts';

/**
 * A turn's calls of the agents' tools (S6a, docs/harness.md "Agents' tools"): the runner only relays. Each call goes to
 * the server as `turn.tool` with a fresh `callId`, after the turn's events so far, and waits for the `turn.tool.result`
 * that names it, at most `TOOL_REPLY_MS`; the server's text is the tool's answer. Nothing is queued: a call while the
 * turn ends, or while the link is down, does nothing and says so. A file `task_attach {path}` names is read from the
 * turn's outputs folder here (the server cannot reach it) and sent as `turn.artifact` parts with the call's id right
 * before its `turn.tool`, which carries the file's path, type, size and hash in its input.
 */

/** How long a call waits for the server's answer (the MCP server waits a little longer, `TOOL_TIMEOUT_MS`). */
export const TOOL_REPLY_MS = 55_000;

export const TOOL_ENDING = 'This turn is ending; the tool did nothing.';
export const TOOL_OFFLINE =
  'The runner has lost its link to the server; the tool did nothing. Try again shortly.';
export const TOOL_LOST =
  'The runner lost its link to the server before the answer came: the call may or may not have taken effect. Look ' +
  'before you try again.';
export const TOOL_NO_ANSWER =
  'The server did not answer in time: the call may or may not have taken effect. Look before you try again.';
export const NO_OUTPUTS =
  'This turn has no outputs folder to attach a file from: attach a note (name and text) or a link instead.';

export interface TurnToolsDeps {
  readonly turnId: string;
  readonly timers: Timers;
  readonly log: Log;
  /** Sends a frame after the turn's events so far, while it is attached; false when the link is down. */
  relay(frame: TurnTool | TurnArtifact): boolean;
  /** False once the turn ends or stops: a call then does nothing. */
  live(): boolean;
  /** The turn's outputs folder, for a file attached by its path. */
  readonly artifacts: ArtifactCollector | undefined;
}

interface Pending {
  readonly resolve: (reply: AskReply) => void;
  readonly timer: unknown;
}

const failed = (error: string): AskReply => ({ ok: false, error });

export class TurnToolCalls {
  readonly #deps: TurnToolsDeps;
  readonly #pending = new Map<string, Pending>();

  constructor(deps: TurnToolsDeps) {
    this.#deps = deps;
  }

  /** How many calls wait for the server. */
  get waiting(): number {
    return this.#pending.size;
  }

  /** Relays a call (its input checked by the bridge) and resolves with the server's answer, or why it did nothing. */
  call(tool: string, input: Record<string, unknown>): Promise<AskReply> {
    const { turnId, relay, artifacts } = this.#deps;
    if (!this.#deps.live()) return Promise.resolve(failed(TOOL_ENDING));
    const callId = randomUUID();
    let sent = input;
    let attached: { readonly path: string; readonly stamp: string } | undefined;
    if (tool === 'task_attach' && typeof input.path === 'string') {
      if (artifacts === undefined) return Promise.resolve(failed(NO_OUTPUTS));
      const found = artifacts.attach(input.path);
      if ('error' in found) return Promise.resolve(failed(found.error));
      const { path, contentType, bytes, sha256 } = found.file;
      for (const frame of fileFrames(turnId, 0, found.file, callId))
        if (!relay(frame)) return Promise.resolve(failed(TOOL_OFFLINE));
      sent = { ...input, file: { path, contentType, size: bytes.length, sha256 } };
      attached = { path, stamp: found.stamp };
    }
    const { promise, resolve } = Promise.withResolvers<AskReply>();
    const timer = this.#deps.timers.setTimeout(
      () => this.#settle(callId, failed(TOOL_NO_ANSWER)),
      TOOL_REPLY_MS,
    );
    this.#pending.set(callId, { resolve, timer });
    if (!relay({ type: 'turn.tool', turnId, callId, tool, input: sent })) {
      this.#settle(callId, failed(TOOL_OFFLINE));
      return promise;
    }
    if (attached) artifacts?.sent(attached.path, attached.stamp);
    this.#deps.log.info('turn called a tool', { turnId, callId, tool });
    return promise;
  }

  /** The server's answer to a call; false when no call of that id waits (it timed out, or was never made). */
  result(frame: TurnToolResult): boolean {
    const answer = frame.ok ? { ok: true as const, text: frame.text } : failed(frame.text);
    return this.#settle(frame.callId, answer);
  }

  /** Answers every waiting call with `error` (the turn ended, was let go of, or its link dropped). */
  closeAll(error: string): void {
    for (const callId of [...this.#pending.keys()]) this.#settle(callId, failed(error));
  }

  #settle(callId: string, reply: AskReply): boolean {
    const pending = this.#pending.get(callId);
    if (pending === undefined) return false;
    this.#pending.delete(callId);
    this.#deps.timers.clearTimeout(pending.timer);
    pending.resolve(reply);
    return true;
  }
}
