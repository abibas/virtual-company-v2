import { join } from 'node:path';
import { type InstallableTool, TOOL_PACKAGES } from '@mwc/shared/machines';
import {
  TOOL_OUTPUT_LINE_MAX,
  TOOL_OUTPUT_LINES_MAX,
  TOOLS_INSTALL_TIMEOUT_MS,
} from '@mwc/shared/runner-protocol';
import type { Env } from '../install/host.ts';
import { pathWithCliDir } from '../system/find-cli.ts';
import type { ChildLike, KillGroup, Spawn } from '../system/process.ts';
import type { Timers } from '../system/time.ts';

/**
 * One install of a CLI (docs/machines.md, "Tools"): `npm install -g --prefix <home>/.local <package>@<version>` with the
 * npm beside the runner's Node, as the runner's user (never sudo), in its own process group from the home folder, so
 * the CLI's command lands in `~/.local/bin`, which the CLI search and the service's PATH already have. Every line it
 * prints on either stream is passed on (cut to `TOOL_OUTPUT_LINE_MAX`; after `TOOL_OUTPUT_LINES_MAX` lines one notice,
 * then nothing); it is killed after `TOOLS_INSTALL_TIMEOUT_MS`.
 */

export interface InstallDeps {
  readonly spawn: Spawn;
  readonly killGroup: KillGroup;
  readonly timers: Timers;
  /** One line it printed, as it comes. */
  line(text: string): void;
  /** `TOOLS_INSTALL_TIMEOUT_MS` unless a test shortens it. */
  readonly timeoutMs?: number;
}

/** How an install ended: done, or why not as `<code>: <words>` (`timeout`, `failed`). */
export type InstallEnd = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** A started install: its end, and how to kill it (the runner stopping). */
export interface RunningInstall {
  readonly done: Promise<InstallEnd>;
  kill(): void;
}

/** The notice sent once in place of the lines past `TOOL_OUTPUT_LINES_MAX`. */
export const OUTPUT_CUT = `… more output not shown (over ${TOOL_OUTPUT_LINES_MAX} lines)`;

/** npm's arguments that install `tool` at `version` under `<home>/.local`. */
export function npmInstallArgs(tool: InstallableTool, version: string, home: string): string[] {
  return ['install', '-g', '--prefix', join(home, '.local'), `${TOOL_PACKAGES[tool].name}@${version}`];
}

/** npm's environment: the runner's, less its own `MWC_*` settings, with npm's folder (its Node) first on the PATH. */
export function npmEnv(npm: string, env: Env): Record<string, string> {
  const kept = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('MWC_'),
  );
  return { ...Object.fromEntries(kept), PATH: pathWithCliDir(npm, env.PATH) };
}

/** Splits what a stream prints into lines (`\n`, `\r\n` or `\r`), blank ones left out. */
function lineSplitter(onLine: (line: string) => void) {
  let rest = '';
  const emit = (line: string) => {
    if (line.trim() !== '') onLine(line);
  };
  return {
    push(chunk: Buffer | string): void {
      const parts = (rest + String(chunk)).split(/\r\n|\n|\r/);
      rest = parts.pop() ?? '';
      for (const part of parts) emit(part);
    },
    end(): void {
      emit(rest);
      rest = '';
    },
  };
}

/** Passes lines on, each cut to the line limit, until the count limit: then the notice once, then nothing. */
function lineCap(send: (line: string) => void) {
  let count = 0;
  let last: string | undefined;
  return {
    line(text: string): void {
      last = text;
      count++;
      if (count <= TOOL_OUTPUT_LINES_MAX) send(text.slice(0, TOOL_OUTPUT_LINE_MAX));
      else if (count === TOOL_OUTPUT_LINES_MAX + 1) send(OUTPUT_CUT);
    },
    get last(): string | undefined {
      return last;
    },
  };
}

/** Why npm failed, with its last line when it printed one. */
function failedOf(code: number | null, signal: NodeJS.Signals | null, last: string | undefined): string {
  const why = code === null ? `npm was ended by ${signal ?? 'a signal'}` : `npm exited with code ${code}`;
  return `failed: ${why}${last === undefined ? '' : ` (${last.slice(0, 300)})`}`;
}

/** Starts the install; its `done` never rejects. */
export function startNpmInstall(
  npm: string,
  args: readonly string[],
  where: { readonly env: Env; readonly cwd: string },
  deps: InstallDeps,
): RunningInstall {
  const cap = lineCap((text) => deps.line(text));
  const { promise, resolve } = Promise.withResolvers<InstallEnd>();
  let child: ChildLike | undefined;
  let timer: unknown;
  let ended: InstallEnd | undefined;
  const settle = (end: InstallEnd) => {
    if (ended !== undefined) return;
    ended = end;
    deps.timers.clearTimeout(timer);
    resolve(end);
  };
  const kill = () => {
    if (child?.pid !== undefined) deps.killGroup(child.pid, 'SIGKILL');
  };
  try {
    const env = npmEnv(npm, where.env);
    child = deps.spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, cwd: where.cwd, env });
  } catch (error) {
    settle({ ok: false, error: `failed: ${(error as Error).message}` });
    return { done: promise, kill };
  }
  const out = lineSplitter(cap.line);
  const err = lineSplitter(cap.line);
  child.stdout?.on('data', (chunk: Buffer | string) => out.push(chunk));
  child.stderr?.on('data', (chunk: Buffer | string) => err.push(chunk));
  child.once('error', (error) => settle({ ok: false, error: `failed: ${error.message}` }));
  child.once('close', (code, signal) => {
    out.end();
    err.end();
    settle(code === 0 ? { ok: true } : { ok: false, error: failedOf(code, signal, cap.last) });
  });
  const timeoutMs = deps.timeoutMs ?? TOOLS_INSTALL_TIMEOUT_MS;
  timer = deps.timers.setTimeout(() => {
    kill();
    settle({
      ok: false,
      error: `timeout: npm did not finish within ${Math.round(timeoutMs / 60_000)} minutes`,
    });
  }, timeoutMs);
  return { done: promise, kill };
}
