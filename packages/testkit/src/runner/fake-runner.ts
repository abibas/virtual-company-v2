import type { MachineSample } from '@mwc/shared/machines';
import {
  encodeFrame,
  type FrameError,
  type FsResult,
  type HeldTurn,
  type HoldState,
  parseServerFrame,
  type ResyncRun,
  RUNNER_PROTOCOL_VERSION,
  RUNNER_SUBPROTOCOL,
  type RunnerCaps,
  type RunnerFrame,
  type RunnerHeartbeat,
  type RunnerHello,
  type ServerFrame,
  type ServerHello,
  type ToolsCheck,
  type ToolsInstall,
} from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import { FrameLog } from './frame-log.ts';

/** The Claude Code version a fake runner says it has, unless its caps say otherwise. */
export const FAKE_CLAUDE_VERSION = '2.1.319 (Claude Code)';

/** A fake runner's default answer to `fs.list`: an empty work volume (its `cmdId` set per frame). */
export const FAKE_FOLDER_LIST = {
  type: 'fs.result',
  ok: true,
  path: '/work',
  parent: null,
  entries: [],
  truncated: false,
  home: '/home/runner',
  root: '/work',
} as const satisfies Omit<FsResult, 'cmdId'>;

export interface FakeRunnerOptions {
  /** The server's runner address (`ws://…/api/runner/ws`). */
  readonly url: string;
  /** Sent as `Authorization: Bearer <key>` with the upgrade; no header by default. */
  readonly key?: string;
  /** `runner.hello`'s version; `1.0.0` by default. */
  readonly version?: string;
  /** `runner.hello`'s protocol; `RUNNER_PROTOCOL_VERSION` by default. */
  readonly protocol?: number;
  /**
   * `runner.hello`'s caps over the defaults: Claude Code (`FAKE_CLAUDE_VERSION`, no Codex), eight slots (room for every turn a scene runs), no hold, no power,
   * no terminal, no self-update, no folders, no forks, turns that end with the link (no `reattach`).
   */
  readonly caps?: Partial<RunnerCaps>;
  /** `runner.hello`'s build (a SHA-256, or null from the sources); left out by default, as an older runner does. */
  readonly build?: string | null;
  /** `runner.hello`'s build time (UTC, ISO 8601); null by default, as a runner from its sources or an older one says. */
  readonly builtAt?: string | null;
  /** The runs `runner.resync` reports on every connect; none by default. */
  readonly runs?: readonly ResyncRun[];
  /** The turns its hello names (S5.4); none by default. `FakeRunner.turns` changes them before a reconnect. */
  readonly turns?: readonly HeldTurn[];
  /** The hold `hold.state` reports after each resync; not held by default. */
  readonly hold?: Omit<HoldState, 'type'>;
  /** The samples heartbeats carry, one each, in order; heartbeats after the last carry none. */
  readonly samples?: readonly MachineSample[];
  /**
   * Answers each server frame in place of the default (`cmd.ack` ok, `power.result` ok, `runner.update.result` ok,
   * `fs.result` ok: an empty `/work` for `fs.list`, the path for `fs.mkdir`; and with `caps.tools`, `tools.result` ok:
   * the tools for `tools.check`, with the installed version for `tools.install`); `[]` answers nothing.
   */
  readonly respond?: (frame: ServerFrame) => readonly RunnerFrame[];
}

/** How a socket closed. */
export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
}

/**
 * A runner for the server's tests: a WebSocket client that connects as a runner does (`runner.hello`, then on
 * `server.hello` its `runner.resync` and `hold.state`), sends heartbeats with scripted samples, records every server
 * frame, acks every command, and reconnects when a test asks (it never reconnects by itself).
 */
export class FakeRunner {
  /** Every server frame received, in order (`frames.next(type)` waits for the next one). */
  readonly frames = new FrameLog<ServerFrame>();
  /** The `type` of every frame this protocol does not know. */
  readonly unknown: string[] = [];
  /** Every text that was not a valid frame. */
  readonly invalid: FrameError[] = [];
  /** The runs heartbeats list as live. */
  liveRuns: string[] = [];
  /** The turns the next hello names (S5.4): a runner that kept them across a reconnect or its restart. */
  turns: HeldTurn[];
  readonly #options: FakeRunnerOptions;
  readonly #samples: MachineSample[];
  readonly #startedAt = performance.now();
  #socket: WebSocket | undefined;
  #closed: Promise<CloseInfo> | undefined;
  #onHello: ((hello: ServerHello) => void) | undefined;

  constructor(options: FakeRunnerOptions) {
    this.#options = options;
    this.#samples = [...(options.samples ?? [])];
    this.turns = [...(options.turns ?? [])];
  }

  /** A connected runner. */
  static async connect(options: FakeRunnerOptions): Promise<FakeRunner> {
    const runner = new FakeRunner(options);
    await runner.connect();
    return runner;
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  /** The `runner.hello` it sends. */
  get hello(): RunnerHello {
    const caps: RunnerCaps = {
      harnesses: { claude_code: FAKE_CLAUDE_VERSION, codex: null },
      slots: 8,
      hold: 'none',
      power: [],
      terminal: false,
      selfUpdate: false,
      folders: false,
      forks: false,
      reattach: false,
      agentTools: false,
      ...this.#options.caps,
    };
    const protocol = this.#options.protocol ?? RUNNER_PROTOCOL_VERSION;
    const { build } = this.#options;
    const version = this.#options.version ?? '1.0.0';
    const builtAt = this.#options.builtAt ?? null;
    return {
      type: 'runner.hello',
      protocol,
      version,
      builtAt,
      caps,
      ...(build === undefined ? {} : { build }),
      ...(this.turns.length === 0 ? {} : { turns: [...this.turns] }),
    };
  }

  /**
   * Opens a socket and says hello; resolves with `server.hello` once the resync and the hold state are sent. Rejects
   * when the upgrade is refused or the socket closes first.
   */
  async connect(): Promise<ServerHello> {
    const { key, url } = this.#options;
    const headers: Record<string, string> = key === undefined ? {} : { authorization: `Bearer ${key}` };
    const socket = new WebSocket(url, RUNNER_SUBPROTOCOL, { headers });
    this.#socket = socket;
    this.#closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
    });
    const hello = new Promise<ServerHello>((resolve, reject) => {
      this.#onHello = resolve;
      socket.on('error', reject);
      socket.once('close', (code) => reject(new Error(`The socket closed (${code}) before server.hello`)));
    });
    socket.on('message', (data) => this.#receive(socket, String(data)));
    socket.once('open', () => this.send(this.hello));
    const serverHello = await hello;
    // Straight to the socket: a server that closes right after its hello (4003) gets nothing more, and nothing throws.
    socket.send(encodeFrame({ type: 'runner.resync', runs: [...(this.#options.runs ?? [])] }));
    socket.send(
      encodeFrame({ type: 'hold.state', ...(this.#options.hold ?? { until: null, source: 'server' }) }),
    );
    return serverHello;
  }

  /** Sends a frame; throws when not connected. */
  send(frame: RunnerFrame): void {
    if (!this.#socket || !this.connected) throw new Error('The fake runner is not connected');
    this.#socket.send(encodeFrame(frame));
  }

  /** Sends a heartbeat with the next scripted sample (unless `fields` gives one) and returns it. */
  heartbeat(fields: Partial<Omit<RunnerHeartbeat, 'type'>> = {}): RunnerHeartbeat {
    const sample = fields.sample ?? this.#samples.shift();
    const frame: RunnerHeartbeat = {
      type: 'runner.heartbeat',
      awakeMs: Math.round(performance.now() - this.#startedAt),
      load1: sample?.load1 ?? 0,
      liveRuns: [...this.liveRuns],
      backlog: 0,
      now: Date.now(),
      ...(sample ? { sample } : {}),
      ...fields,
    };
    this.send(frame);
    return frame;
  }

  /** Acks a command by hand (with `respond` returning `[]`): ok, or failed with `error`. */
  ack(cmdId: string, error?: string): void {
    this.send({ type: 'cmd.ack', cmdId, ok: error === undefined, ...(error === undefined ? {} : { error }) });
  }

  /** How the current socket closed, once it does (by either side). */
  closed(): Promise<CloseInfo> {
    if (!this.#closed) throw new Error('The fake runner never connected');
    return this.#closed;
  }

  /** Closes the socket (1000 by default) and waits for it; nothing when it is already closed. */
  async disconnect(code = 1000): Promise<void> {
    if (!this.#socket || this.#socket.readyState === WebSocket.CLOSED) return;
    this.#socket.close(code);
    await this.#closed;
  }

  /** `disconnect`, then `connect` again. */
  async reconnect(): Promise<ServerHello> {
    await this.disconnect();
    return this.connect();
  }

  #receive(socket: WebSocket, text: string): void {
    const parsed = parseServerFrame(text);
    if (parsed.kind === 'unknown') this.unknown.push(parsed.type);
    if (parsed.kind === 'invalid') this.invalid.push(parsed.error);
    if (parsed.kind !== 'frame') return;
    const frame = parsed.frame;
    this.frames.push(frame);
    if (frame.type === 'server.hello') {
      this.#onHello?.(frame);
      this.#onHello = undefined;
      return;
    }
    for (const reply of this.#answer(frame)) socket.send(encodeFrame(reply));
  }

  #answer(frame: ServerFrame): readonly RunnerFrame[] {
    if (this.#options.respond) return this.#options.respond(frame);
    if (frame.type === 'power.command') return [{ type: 'power.result', cmdId: frame.cmdId, ok: true }];
    if (frame.type === 'runner.update')
      return [{ type: 'runner.update.result', cmdId: frame.cmdId, ok: true }];
    if (frame.type === 'fs.list') return [{ ...FAKE_FOLDER_LIST, cmdId: frame.cmdId }];
    if (frame.type === 'fs.mkdir')
      return [{ type: 'fs.result', cmdId: frame.cmdId, ok: true, path: frame.path }];
    if (frame.type === 'tools.check' || frame.type === 'tools.install') return this.#tools(frame);
    return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
  }

  /** The tools frames: their result with `caps.tools` (and the installed version), else acked as a runner older than them. */
  #tools(frame: ToolsCheck | ToolsInstall): readonly RunnerFrame[] {
    const { tools } = this.hello.caps;
    if (tools === undefined)
      return [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: false, error: 'unknown command' }];
    const after = frame.type === 'tools.install' ? { ...tools, [frame.tool]: frame.version } : tools;
    return [{ type: 'tools.result', cmdId: frame.cmdId, ok: true, tools: after }];
  }
}
