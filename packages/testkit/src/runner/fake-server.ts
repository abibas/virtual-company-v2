import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { newId } from '@mwc/shared/ids';
import {
  encodeFrame,
  type FrameError,
  parseRunnerFrame,
  RUNNER_FRAME_MAX_BYTES,
  RUNNER_PROTOCOL_VERSION,
  RUNNER_SUBPROTOCOL,
  RUNNER_WS_PATH,
  type RunnerFrame,
  type ServerFrame,
} from '@mwc/shared/runner-protocol';
import { type WebSocket, WebSocketServer } from 'ws';
import { FrameLog } from './frame-log.ts';

export interface FakeRunnerServerOptions {
  /** The `machineId` of `server.hello`; a new id by default. */
  readonly machineId?: string;
  /** The `minRunnerVersion` of `server.hello`; `0.0.0` by default. */
  readonly minRunnerVersion?: string;
  /** Answer each `runner.hello` with `server.hello` (true by default; false to test a runner left waiting). */
  readonly hello?: boolean;
  /** `server.hello.resume`: a server that takes a runner's turns back (S5.4); left out by default, as an older one. */
  readonly resume?: boolean;
}

/** One WebSocket a runner opened: its `Authorization` header and the subprotocol agreed ('' for none). */
export interface RunnerConnection {
  readonly authorization: string | undefined;
  readonly protocol: string;
}

/**
 * A runner protocol server for a runner's tests: a real WebSocket server on 127.0.0.1 and an ephemeral port, at
 * `RUNNER_WS_PATH`, speaking `mwc-runner.v1`. It records every frame, answers `runner.hello`, sends any server frame,
 * drops every socket at once (`dropAll`), and stops and starts again on the same port (`restart`), as a server that
 * crashed and came back. It closes every socket with a code (`closeAll`) and pings them (`ping`), as the real hub does.
 * It checks no key: `connections` shows what the runner sent.
 */
export class FakeRunnerServer {
  /** Every runner frame received, in order (`frames.next(type)` waits for the next one). */
  readonly frames = new FrameLog<RunnerFrame>();
  /** The `type` of every frame this protocol does not know. */
  readonly unknown: string[] = [];
  /** Every text that was not a valid frame. */
  readonly invalid: FrameError[] = [];
  /** Every connection, in order, over every start. */
  readonly connections: RunnerConnection[] = [];
  readonly machineId: string;
  readonly #options: FakeRunnerServerOptions;
  readonly #sockets = new Set<WebSocket>();
  #http: Server | undefined;
  #wss: WebSocketServer | undefined;
  #port = 0;

  private constructor(options: FakeRunnerServerOptions) {
    this.#options = options;
    this.machineId = options.machineId ?? newId();
  }

  /** A started server. */
  static async start(options: FakeRunnerServerOptions = {}): Promise<FakeRunnerServer> {
    const server = new FakeRunnerServer(options);
    await server.start();
    return server;
  }

  get port(): number {
    return this.#port;
  }

  /** The address a runner dials: `ws://127.0.0.1:<port>/api/runner/ws`. */
  get url(): string {
    return `ws://127.0.0.1:${this.#port}${RUNNER_WS_PATH}`;
  }

  /** How many sockets are open now. */
  get openSockets(): number {
    return this.#sockets.size;
  }

  /** Listens again, on the same port once it has one; does nothing while it listens. */
  async start(): Promise<void> {
    if (this.#http) return;
    const http = createServer();
    const wss = new WebSocketServer({
      server: http,
      path: RUNNER_WS_PATH,
      maxPayload: RUNNER_FRAME_MAX_BYTES,
      handleProtocols: (protocols) => (protocols.has(RUNNER_SUBPROTOCOL) ? RUNNER_SUBPROTOCOL : false),
    });
    wss.on('connection', (socket, request) => {
      this.connections.push({ authorization: request.headers.authorization, protocol: socket.protocol });
      this.#sockets.add(socket);
      socket.on('close', () => this.#sockets.delete(socket));
      socket.on('message', (data) => this.#receive(socket, String(data)));
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.#port, '127.0.0.1', () => resolve());
    });
    this.#port = (http.address() as AddressInfo).port;
    this.#http = http;
    this.#wss = wss;
  }

  /** Sends a frame to every open socket; returns how many got it. */
  send(frame: ServerFrame): number {
    return this.sendRaw(encodeFrame(frame));
  }

  /** Sends any text (an unknown or broken frame) to every open socket; returns how many got it. */
  sendRaw(text: string): number {
    for (const socket of this.#sockets) socket.send(text);
    return this.#sockets.size;
  }

  /** Closes every socket with a close frame (`RUNNER_CLOSE` codes: 4001, 4003, 4004…) and waits until they closed. */
  async closeAll(code: number, reason = ''): Promise<void> {
    const sockets = [...this.#sockets];
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once('close', () => resolve());
            socket.close(code, reason);
          }),
      ),
    );
  }

  /** Pings every open socket, as the server does every 20 s; resolves once each answered with a pong. */
  async ping(): Promise<number> {
    const sockets = [...this.#sockets];
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once('pong', () => resolve());
            socket.ping();
          }),
      ),
    );
    return sockets.length;
  }

  /** Cuts every socket at once, without a close frame (the runner sees 1006), and keeps listening. */
  dropAll(): void {
    for (const socket of this.#sockets) socket.terminate();
    this.#sockets.clear();
  }

  /** Cuts every socket and stops listening, as a server that went down. */
  async stop(): Promise<void> {
    const http = this.#http;
    if (!http) return;
    this.#http = undefined;
    this.dropAll();
    this.#wss?.close();
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  }

  /** A server restart: `stop`, then `start` on the same port. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  #receive(socket: WebSocket, text: string): void {
    const parsed = parseRunnerFrame(text);
    if (parsed.kind === 'unknown') this.unknown.push(parsed.type);
    if (parsed.kind === 'invalid') this.invalid.push(parsed.error);
    if (parsed.kind !== 'frame') return;
    if (parsed.frame.type === 'runner.hello' && this.#options.hello !== false) {
      const hello: ServerFrame = {
        type: 'server.hello',
        protocol: RUNNER_PROTOCOL_VERSION,
        minRunnerVersion: this.#options.minRunnerVersion ?? '0.0.0',
        machineId: this.machineId,
        ...(this.#options.resume === undefined ? {} : { resume: this.#options.resume }),
      };
      socket.send(encodeFrame(hello));
    }
    this.frames.push(parsed.frame);
  }
}
