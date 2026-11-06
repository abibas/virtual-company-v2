import { type DbHandle, type TenantDb, tenant } from '@mwc/db';
import {
  type CmdAck,
  encodeFrame,
  type PowerResult,
  parseRunnerFrame,
  RUNNER_CLOSE,
  RUNNER_PROTOCOL_VERSION,
  type RunnerFrame,
  type RunnerHello,
  type ServerFrame,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerCredential } from '../../../platform/auth/api-keys.ts';
import type { SocketLink } from '../../../platform/realtime/sockets.ts';
import { isTooOld } from '../rules.ts';
import { heartbeat, hold, type OpenSession, offline, online, tooOld } from './presence.ts';

/** Why a request to a runner failed: no ready connection, no answer in time, or the socket closed first. */
export type HubErrorCode = 'offline' | 'timeout' | 'disconnected';

export class HubError extends Error {
  readonly code: HubErrorCode;
  readonly machineId: string;

  constructor(code: HubErrorCode, machineId: string, message: string) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.machineId = machineId;
  }
}

/** What a connection needs from its hub. */
export interface ConnectionContext {
  readonly db: DbHandle;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly helloTimeoutMs: number;
  readonly minRunnerVersion: string;
  /** Runs `work` once the work queued before it for this machine is done (one machine's writes stay in order). */
  enqueue(machineId: string, work: () => Promise<void>): void;
  /** Makes this connection its machine's current one, closing the one it replaces with 4004. */
  claim(connection: RunnerConnection): void;
  /** Forgets this connection; true when it was its machine's current one. */
  release(connection: RunnerConnection): boolean;
}

interface Pending {
  readonly resolve: (reply: CmdAck | PowerResult) => void;
  readonly reject: (error: HubError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * One runner socket, from the upgrade to its close (docs/runner-protocol.md, "Connection"): it waits for `runner.hello`
 * (4008 after the timeout), refuses another protocol (4002) and a runner too old (4003, after `server.hello`), takes
 * over from an older connection of its machine (closed 4004), records the machine online with a session and then answers
 * `server.hello`. Heartbeats and `hold.state` update the machine; command replies settle the hub's requests; frames of
 * runs (S5) are accepted and left; unknown frames are ignored, invalid ones logged. Its close ends the session and, unless
 * it was replaced, takes the machine offline.
 */
export class RunnerConnection {
  readonly runner: RunnerCredential;
  readonly link: SocketLink;
  /** Its hello, once accepted. */
  hello: RunnerHello | undefined;
  /** When it answered `server.hello`: commands go to it from then on. */
  readyAt: Date | undefined;
  /** A newer connection of the machine took over. */
  replaced = false;
  /** Resolves when the socket has closed. */
  readonly done: Promise<void>;
  readonly #ctx: ConnectionContext;
  readonly #pending = new Map<string, Pending>();
  readonly #helloTimer: ReturnType<typeof setTimeout>;
  readonly #settle: () => void;
  #session: OpenSession | undefined;
  #tenant: Promise<TenantDb> | undefined;

  constructor(ctx: ConnectionContext, link: SocketLink, runner: RunnerCredential) {
    this.#ctx = ctx;
    this.link = link;
    this.runner = runner;
    const done = Promise.withResolvers<void>();
    this.done = done.promise;
    this.#settle = done.resolve;
    this.#helloTimer = setTimeout(
      () => link.close(RUNNER_CLOSE.helloTimeout, 'No runner.hello in time'),
      ctx.helloTimeoutMs,
    );
  }

  get machineId(): string {
    return this.runner.machineId;
  }

  /** A text frame from the runner (none come after its close). */
  message(text: string): void {
    const parsed = parseRunnerFrame(text);
    if (parsed.kind === 'frame') this.#dispatch(parsed.frame);
    else if (parsed.kind === 'unknown')
      this.#log('debug', { type: parsed.type }, 'runner: ignored an unknown frame');
    else {
      const { code, frameType, message } = parsed.error;
      this.#log('warn', { code, frameType, error: message }, 'runner: ignored an invalid frame');
    }
  }

  /** Sends a command and resolves with its reply (`cmd.ack`, or `power.result`), or rejects after `timeoutMs`. */
  request(frame: Extract<ServerFrame, { cmdId: string }>, timeoutMs: number): Promise<CmdAck | PowerResult> {
    return new Promise((resolve, reject) => {
      const text = encodeFrame(frame);
      const timer = setTimeout(() => {
        this.#pending.delete(frame.cmdId);
        reject(new HubError('timeout', this.machineId, `No answer to ${frame.type} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(frame.cmdId, { resolve, reject, timer });
      this.link.send(text);
    });
  }

  /**
   * The socket closed (either side; once, as the socket reports it): pending requests fail, the session ends, the
   * machine goes offline unless a newer connection took over.
   */
  closed(code: number): void {
    clearTimeout(this.#helloTimer);
    for (const [cmdId, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new HubError('disconnected', this.machineId, `The runner disconnected before answering ${cmdId}`),
      );
    }
    this.#pending.clear();
    const current = this.#ctx.release(this);
    if (this.hello !== undefined) {
      this.#log('info', { code, replaced: this.replaced }, 'runner: disconnected');
      this.#run((t) => offline(t, this.machineId, this.#session, current, this.#ctx.clock()));
    }
    this.#ctx.enqueue(this.machineId, async () => this.#settle());
  }

  #dispatch(frame: RunnerFrame): void {
    if (frame.type === 'runner.hello') this.#onHello(frame);
    else if (frame.type === 'cmd.ack' || frame.type === 'power.result') this.#onReply(frame);
    else if (this.hello === undefined || this.replaced) {
      this.#log('debug', { type: frame.type }, 'runner: ignored a frame outside its accepted hello');
    } else if (frame.type === 'runner.heartbeat') {
      const now = this.#ctx.clock();
      this.#run((t) => heartbeat(t, this.machineId, now, frame.sample));
    } else if (frame.type === 'hold.state') {
      this.#run((t) => hold(t, this.machineId, frame.until, frame.source));
    } else {
      this.#log(
        'debug',
        { type: frame.type },
        'runner: accepted a frame with nothing to do before runs (S5)',
      );
    }
  }

  #onHello(hello: RunnerHello): void {
    if (this.hello !== undefined) {
      this.#log('warn', {}, 'runner: ignored a second runner.hello');
      return;
    }
    clearTimeout(this.#helloTimer);
    const serverHello = encodeFrame({
      type: 'server.hello',
      protocol: RUNNER_PROTOCOL_VERSION,
      minRunnerVersion: this.#ctx.minRunnerVersion,
      machineId: this.machineId,
    });
    if (hello.protocol !== RUNNER_PROTOCOL_VERSION) {
      this.link.close(RUNNER_CLOSE.unsupportedProtocol, `Protocol ${RUNNER_PROTOCOL_VERSION} only`);
      return;
    }
    if (isTooOld(hello.version, this.#ctx.minRunnerVersion)) {
      this.#run(async (t) => {
        await tooOld(t, this.machineId, hello.version);
        this.link.send(serverHello);
        this.link.close(RUNNER_CLOSE.runnerTooOld, `Runner ${this.#ctx.minRunnerVersion} or later needed`);
      });
      return;
    }
    this.hello = hello;
    this.#ctx.claim(this);
    const now = this.#ctx.clock();
    const facts = { version: hello.version, claudeVersion: hello.claudeVersion, slots: hello.caps.slots };
    this.#run(
      async (t) => {
        this.#session = await online(t, this.machineId, { ...facts, remoteIp: this.link.remoteIp, now });
        this.readyAt = now;
        this.link.send(serverHello);
        this.#log('info', { version: hello.version }, 'runner: connected');
      },
      () => this.link.close(1011, 'The server could not record the connection'),
    );
  }

  #onReply(reply: CmdAck | PowerResult): void {
    const pending = this.#pending.get(reply.cmdId);
    if (pending === undefined) {
      this.#log('debug', { cmdId: reply.cmdId }, 'runner: a reply nobody waits for');
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(reply.cmdId);
    pending.resolve(reply);
  }

  /** Queues work on the machine's company; a failure is logged (and `failed` runs), never thrown. */
  #run(work: (t: TenantDb) => Promise<void>, failed?: () => void): void {
    this.#ctx.enqueue(this.machineId, async () => {
      try {
        this.#tenant ??= tenant(this.#ctx.db, this.runner.companyId);
        await work(await this.#tenant);
      } catch (error) {
        this.#log('error', { err: error }, 'runner: could not record what the runner said');
        failed?.();
      }
    });
  }

  #log(level: 'debug' | 'info' | 'warn' | 'error', fields: object, message: string): void {
    this.#ctx.logger[level](
      { machineId: this.machineId, companyId: this.runner.companyId, ...fields },
      message,
    );
  }
}
