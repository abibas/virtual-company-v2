import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Logger } from 'pino';
import { alignmentArgs, fromServerJson, type SpeechText } from './transcript.ts';

/**
 * The warm whisper-server (docs/speech.md): started on 127.0.0.1:<MWC_WHISPER_PORT> on the first clip, so the model
 * loads once, kept while it lives, started again on a later clip when it died, and stopped with the API. A start that
 * fails is not tried again for a minute (whisper-cli does the clips meanwhile). Node's `spawn` and `fetch` are injected,
 * so tests start nothing.
 */

/** `spawn` of `node:child_process`, as the speech processes call it. */
export type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface WarmServerDeps {
  /** The whisper-server binary. */
  readonly bin: string;
  readonly model: string;
  readonly port: number;
  readonly language: string;
  readonly prompt: string | undefined;
  readonly threads: number;
  readonly spawn: Spawn;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  /** Milliseconds, for the start's deadline and the retry's pause. */
  readonly now: () => number;
  readonly logger: Logger;
}

export interface WarmServer {
  /** The port of a server that answers, starting it when there is none; undefined while it cannot start. */
  port(): Promise<number | undefined>;
  /** One clip through the server's `/inference`; throws when it fails, so the caller can use whisper-cli. */
  transcribe(port: number, wav: Uint8Array<ArrayBuffer>): Promise<SpeechText>;
  close(): Promise<void>;
}

const START_MS = 90_000;
const POLL_MS = 250;
const RETRY_MS = 60_000;
const TRANSCRIBE_MS = 120_000;
const STOP_MS = 3_000;

/**
 * The server must not outlive the API (a crash, a kill, a watch restart): this shell starts it in the background,
 * kills it once the API's end of the shell's stdin closes, and exits when it does. The watcher reads that pipe on fd 3,
 * since a background job's own stdin is /dev/null.
 */
const TIED_TO_API =
  'exec 3<&0; "$@" </dev/null 3<&- & server=$!; { cat <&3 >/dev/null; kill "$server" 2>/dev/null; } & exec 3<&-; wait "$server"';

interface Running {
  readonly child: ChildProcess;
  exited: boolean;
  readonly exit: Promise<void>;
}

function track(child: ChildProcess): Running {
  let done!: () => void;
  const running: Running = { child, exited: false, exit: new Promise<void>((resolve) => (done = resolve)) };
  const end = () => {
    running.exited = true;
    child.stdin?.end();
    done();
  };
  child.once('exit', end);
  child.once('error', end);
  child.stdin?.on('error', () => {});
  return running;
}

/** Stops the server: its shell's stdin closed, SIGTERM, and up to 3 s for it to exit. */
async function stopServer(deps: WarmServerDeps, running: Running): Promise<void> {
  running.child.stdin?.end();
  if (!running.exited) running.child.kill('SIGTERM');
  await Promise.race([running.exit, deps.sleep(STOP_MS)]);
}

/** Starts whisper-server and waits up to 90 s for its `/health`; undefined (and stopped) when it never answered. */
async function startServer(deps: WarmServerDeps, closed: () => boolean): Promise<Running | undefined> {
  const args = ['-m', deps.model, '--host', '127.0.0.1', '--port', String(deps.port)];
  args.push('-l', deps.language, '-t', String(deps.threads), ...alignmentArgs(deps.model));
  const stdio: SpawnOptions['stdio'] = ['pipe', 'ignore', 'ignore'];
  const running = track(
    deps.spawn('/bin/sh', ['-c', TIED_TO_API, 'whisper-server', deps.bin, ...args], { stdio }),
  );
  const healthy = () =>
    deps.fetch(`http://127.0.0.1:${deps.port}/health`, { signal: AbortSignal.timeout(2_000) }).then(
      (res) => res.ok,
      () => false,
    );
  const deadline = deps.now() + START_MS;
  while (!running.exited && !closed() && deps.now() < deadline) {
    if (await healthy()) return running;
    await deps.sleep(POLL_MS);
  }
  await stopServer(deps, running);
  if (!closed())
    deps.logger.warn('speech: whisper-server did not start; dictation uses whisper-cli for a minute');
  return undefined;
}

export function warmServer(deps: WarmServerDeps): WarmServer {
  let current: Running | undefined;
  let starting: Promise<Running | undefined> | undefined;
  let failedAt: number | undefined;
  let closed = false;
  const stop = (running: Running) => stopServer(deps, running);
  const start = () => startServer(deps, () => closed);

  async function port(): Promise<number | undefined> {
    if (closed) return undefined;
    if (current !== undefined && !current.exited) return deps.port;
    current = undefined;
    if (starting === undefined) {
      if (failedAt !== undefined && deps.now() - failedAt < RETRY_MS) return undefined;
      starting = start().then((running) => {
        starting = undefined;
        if (running === undefined) failedAt = deps.now();
        else if (closed) void stop(running);
        else {
          current = running;
          deps.logger.info({ port: deps.port }, 'speech: whisper-server is warm');
        }
        return closed ? undefined : running;
      });
    }
    return (await starting) === undefined ? undefined : deps.port;
  }

  async function transcribe(at: number, wav: Uint8Array<ArrayBuffer>): Promise<SpeechText> {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
    form.append('response_format', 'verbose_json');
    if (deps.prompt !== undefined) form.append('prompt', deps.prompt);
    const res = await deps.fetch(`http://127.0.0.1:${at}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_MS),
    });
    if (!res.ok) throw new Error(`whisper-server answered ${res.status}`);
    return fromServerJson(await res.json());
  }

  async function close(): Promise<void> {
    closed = true;
    const running = current;
    current = undefined;
    if (running !== undefined) await stop(running);
  }

  return { port, transcribe, close };
}
