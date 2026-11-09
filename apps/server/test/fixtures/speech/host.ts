/**
 * A fake computer for the speech process tests: a recorded `spawn` (the sign-in helpers' fake child), a `fetch` that
 * plays whisper-server, a temporary folder in memory, and a clock that moves only when the code sleeps. Nothing runs.
 */
import { captureLogger } from '@mwc/testkit';
import { fakeSpawn, type SpawnCall } from '../credentials/sign-in/child.ts';

export interface FakeWhisperServer {
  /** `/health` answers 200 (else 503). */
  healthy: boolean;
  /** What `/inference` answers: JSON with this status. */
  inference: { status: number; body: unknown };
  /** Every URL fetched, in order. */
  readonly urls: string[];
  /** The form fields of each `/inference` call (the file's size instead of the file). */
  readonly forms: Record<string, string | number>[];
}

export interface FakeFiles {
  /** The files written and not removed, by path. */
  readonly files: Map<string, Uint8Array>;
  /** The folders made, and those removed. */
  readonly made: string[];
  readonly removed: string[];
  /** Puts this text at `<dir>/out.json` when whisper-cli runs in a folder. */
  output: string | undefined;
}

async function formFields(body: unknown): Promise<Record<string, string | number>> {
  const fields: Record<string, string | number> = {};
  for (const [key, value] of (body as FormData).entries())
    fields[key] = typeof value === 'string' ? value : (await value.arrayBuffer()).byteLength;
  return fields;
}

export function fakeServer(): FakeWhisperServer & { fetch: typeof fetch } {
  const state: FakeWhisperServer = {
    healthy: true,
    inference: { status: 200, body: {} },
    urls: [],
    forms: [],
  };
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    state.urls.push(url);
    if (url.endsWith('/health')) return new Response('{}', { status: state.healthy ? 200 : 503 });
    state.forms.push(await formFields(init?.body));
    return new Response(JSON.stringify(state.inference.body), { status: state.inference.status });
  };
  return Object.assign(state, { fetch: fetchFake as typeof fetch });
}

export function fakeFiles(): FakeFiles & {
  tempDir(): Promise<string>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  remove(dir: string): Promise<void>;
} {
  const state: FakeFiles = { files: new Map(), made: [], removed: [], output: undefined };
  return Object.assign(state, {
    tempDir: async () => {
      const dir = `/tmp/speech-${state.made.length + 1}`;
      state.made.push(dir);
      return dir;
    },
    write: async (path: string, bytes: Uint8Array) => void state.files.set(path, bytes.slice()),
    read: async (path: string) => {
      const file = state.files.get(path);
      if (file === undefined) throw new Error(`ENOENT ${path}`);
      return new TextDecoder().decode(file);
    },
    remove: async (dir: string) => {
      state.removed.push(dir);
      for (const path of [...state.files.keys()]) if (path.startsWith(`${dir}/`)) state.files.delete(path);
    },
  });
}

/** whisper-cli's `-of <dir>/out`: where the fake writes its answer. */
export function cliOutputDir(call: SpawnCall): string {
  const at = call.args.indexOf('-of');
  return (call.args[at + 1] as string).replace(/\/out$/, '');
}

/**
 * The whole fake host: `script` makes each spawned child behave (by default whisper-server stays up and whisper-cli
 * writes `files.output` and exits 0). `later` callbacks wait in `timers` until a test fires them.
 */
export function fakeHost(script?: (call: SpawnCall) => void) {
  const server = fakeServer();
  const files = fakeFiles();
  const clock = { ms: 0 };
  const timers: { ms: number; callback: () => void; cancelled: boolean }[] = [];
  const byDefault = (call: SpawnCall) => {
    if (call.command === '/bin/sh') return;
    setImmediate(() => {
      if (files.output !== undefined)
        files.files.set(`${cliOutputDir(call)}/out.json`, new TextEncoder().encode(files.output));
      call.child.emit('close', 0);
    });
  };
  const spawned = fakeSpawn(script ?? byDefault);
  const capture = captureLogger();
  return {
    server,
    files,
    clock,
    timers,
    calls: spawned.calls,
    logs: capture.lines,
    logger: capture.logger,
    deps: {
      spawn: spawned.spawn,
      fetch: server.fetch,
      files,
      // The clock moves by `ms`; a later tick lets the test change the fake meanwhile.
      sleep: async (ms: number) => {
        clock.ms += ms;
        await new Promise((resolve) => setImmediate(resolve));
      },
      now: () => clock.ms,
      later: (ms: number, callback: () => void) => {
        const timer = { ms, callback, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      threads: 4,
    },
  };
}
