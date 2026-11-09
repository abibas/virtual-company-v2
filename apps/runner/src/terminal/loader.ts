import { RUNNER_PTY_TARGETS, type RunnerPtyTarget } from '@mwc/shared/runner-protocol';

/**
 * The terminal's PTY (docs/machines.md, "Terminal"): node-pty's prebuilt build for this system, the package
 * `@lydell/node-pty-<platform>-<arch>`, loaded when the daemon starts and never bundled. From the sources it is the runner
 * package's own dependency; an installed runner finds it in `node_modules/` next to `runner.mjs`, where the installer
 * unpacked it (the container image puts it there too). When it cannot load, the runner has no terminal and says why.
 */

/** What the runner uses of a node-pty terminal. */
export interface PtyProcess {
  readonly pid: number;
  /** What the terminal printed: Buffers, since the runner opens it with `encoding: null`. */
  onData(listener: (data: Buffer | string) => void): unknown;
  /** The shell ended: its exit code, and the number of the signal that ended it (0 or none when it exited). */
  onExit(listener: (exit: { exitCode: number; signal?: number | undefined }) => void): unknown;
  write(data: Buffer | string): void;
  resize(cols: number, rows: number): void;
  /** Signals the shell (`SIGHUP` by default). */
  kill(signal?: string): void;
  /** Stops reading the terminal's output (the link is backed up) until `resume`. */
  pause(): void;
  resume(): void;
}

export interface PtyOptions {
  /** The terminal type, also its `TERM`. */
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** null: the output comes as raw bytes. */
  readonly encoding: null;
}

/** node-pty's `spawn`, narrowed to what the runner uses. */
export type PtySpawn = (file: string, args: readonly string[], options: PtyOptions) => PtyProcess;

export type PtyLoad =
  | { readonly ok: true; readonly target: RunnerPtyTarget; readonly spawn: PtySpawn }
  | { readonly ok: false; readonly reason: string };

/** The package of a system's prebuilt PTY. */
export const ptyPackage = (target: RunnerPtyTarget): string => `@lydell/node-pty-${target}`;

/** The PTY target of a system (`darwin-arm64`), or undefined when none is built for it. */
export function ptyTarget(platform: string, arch: string): RunnerPtyTarget | undefined {
  const target = `${platform}-${arch}`;
  return RUNNER_PTY_TARGETS.find((known) => known === target);
}

export interface PtyLoaderDeps {
  readonly platform: string;
  readonly arch: string;
  /** Node's `require`, made from the runner's own address (`createRequire(import.meta.url)`). */
  load(name: string): unknown;
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string;

/** Loads this system's PTY; why not, in words for the log, when it cannot. */
export function loadPty(deps: PtyLoaderDeps): PtyLoad {
  const target = ptyTarget(deps.platform, deps.arch);
  if (target === undefined) {
    return { ok: false, reason: `no terminal PTY is built for ${deps.platform}-${deps.arch}` };
  }
  const name = ptyPackage(target);
  let module: unknown;
  try {
    module = deps.load(name);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'MODULE_NOT_FOUND') {
      return {
        ok: false,
        reason: `${name} is not installed next to the runner; install the runner again (install.sh) to get it`,
      };
    }
    return { ok: false, reason: `cannot load ${name}: ${firstLine(error)}` };
  }
  const spawn = (module as { spawn?: unknown } | null | undefined)?.spawn;
  if (typeof spawn !== 'function') return { ok: false, reason: `${name} has no spawn function` };
  return {
    ok: true,
    target,
    spawn: (file, args, options) => (spawn as (...values: unknown[]) => PtyProcess)(file, [...args], options),
  };
}
