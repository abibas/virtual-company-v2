/**
 * What a terminal starts (docs/machines.md, "Terminal"): the user's login shell as a login shell, in the home folder,
 * with the runner's own environment less every `MWC_*` variable (the runner's configuration, and a container's
 * enrollment token), `TERM=xterm-256color`, and a UTF-8 locale when the environment names none (a service starts with
 * almost no environment, and xterm.js speaks UTF-8).
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** The terminal type the browser's xterm.js emulates. */
export const TERMINAL_TERM = 'xterm-256color';

/** The shells tried, in order, when `SHELL` names none that exists. */
export const FALLBACK_SHELLS = ['/bin/bash', '/bin/sh'] as const;

/** The flag that makes it a login shell (bash, zsh, dash, fish and ksh all take it). */
export const LOGIN_FLAG = '-l';

/** The login shell: `SHELL` when it exists, else `/bin/bash`, else `/bin/sh`. */
export function loginShell(env: Env, exists: (path: string) => boolean): string {
  const own = env.SHELL;
  if (own?.startsWith('/') && exists(own)) return own;
  return FALLBACK_SHELLS.find((shell) => exists(shell)) ?? '/bin/sh';
}

/** The locale given to a terminal whose environment names none. */
export const utf8Locale = (platform: NodeJS.Platform): string =>
  platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';

/** A terminal's environment: the runner's, less `MWC_*`, with the terminal type and, if none is set, a UTF-8 locale. */
export function terminalEnv(env: Env, platform: NodeJS.Platform): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.startsWith('MWC_')) out[key] = value;
  }
  out.TERM = TERMINAL_TERM;
  if (!out.LANG && !out.LC_ALL && !out.LC_CTYPE) out.LANG = utf8Locale(platform);
  return out;
}
