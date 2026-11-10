import type { ProcessSpec } from '@mwc/harness-core';
import type { TerminalSpec } from '@mwc/shared/harness';
import { processEnv } from '../turns/env.ts';
import { type PrivateLease, withPrivateDir } from '../turns/private-dir.ts';
import type { HarnessHost } from '../turns/turns.ts';
import { type Env, LOGIN_FLAG, loginShell, terminalEnv } from './shell.ts';

/**
 * What a terminal starts (docs/machines.md, "Terminal"; docs/harness.md, "How a turn runs"): the user's login shell in
 * the home folder, or, for a chat's terminal (`terminal.open` with `harness`), the harness's own TUI from its driver,
 * in the agent's folder, with the terminal's environment less what the driver unsets plus its own, and its private
 * folder (a Codex login, Claude Code's settings file, for the session's lifetime). The driver's notices are printed
 * above the TUI.
 */

export interface TerminalLaunch {
  /** The program: the shell, or the harness's CLI (what `terminal.opened` names). */
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Printed before the program's own output. */
  readonly banner?: string;
  /** The private folder in use while the session lives. */
  readonly lease?: PrivateLease;
}

/** What a shell terminal needs of the machine. */
export interface ShellMachine {
  readonly env: Env;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  exists(path: string): boolean;
}

/** The login shell in the home folder. */
export function shellLaunch(machine: ShellMachine): TerminalLaunch {
  return {
    file: loginShell(machine.env, machine.exists),
    args: [LOGIN_FLAG],
    cwd: machine.home,
    env: terminalEnv(machine.env, machine.platform),
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The driver's notices as lines above the TUI. */
const bannerOf = (process: ProcessSpec): string | undefined =>
  process.notices.length === 0
    ? undefined
    : process.notices.map((notice) => `[${notice.level}] ${notice.message}\r\n`).join('');

/**
 * A chat's terminal: the harness's TUI, or why not (`unsupported`, `home_missing`, `invalid_spec: …`,
 * `spawn_failed: …` when its private folder cannot be made).
 */
export function harnessLaunch(
  spec: TerminalSpec,
  harness: HarnessHost | undefined,
  machine: ShellMachine,
): TerminalLaunch | { readonly refused: string } {
  const driver = harness?.drivers[spec.harness];
  if (harness === undefined || driver === undefined) return { refused: 'unsupported' };
  if (!harness.isDirectory(spec.cwd)) return { refused: 'home_missing' };
  let built: ProcessSpec;
  try {
    built = driver.terminal(spec);
  } catch (error) {
    return { refused: `invalid_spec: ${messageOf(error)}` };
  }
  let lease: PrivateLease | undefined;
  try {
    lease = built.privateDir && harness.dirs.acquire(built.privateDir, spec.harness, spec.cwd);
  } catch (error) {
    return { refused: `spawn_failed: ${messageOf(error)}` };
  }
  const { process, env: extra } = withPrivateDir(built, lease);
  const banner = bannerOf(process);
  return {
    file: process.command,
    args: process.args,
    cwd: spec.cwd,
    env: processEnv(terminalEnv(machine.env, machine.platform), process, extra),
    ...(banner === undefined ? {} : { banner }),
    ...(lease === undefined ? {} : { lease }),
  };
}
