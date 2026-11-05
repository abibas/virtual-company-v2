import { join } from 'node:path';
import type { LoginHelper } from './port.ts';
import { childSandbox, type Spawn } from './process.ts';
import { ttyArgv } from './tty.ts';

/**
 * The production sign-in helper (MWC_LOGIN_HELPER=local), for a Linux server whose own container has the CLIs and
 * util-linux's `script`: each login runs in a private temporary folder (0700, from `mkdtemp`) that is its whole home,
 * removed afterwards. The CLI gets an environment made from nothing: HOME and CODEX_HOME in that folder, PATH, the
 * terminal and the CLIs' switches for updates and telemetry. Nothing of the server's environment is passed on (no
 * CLAUDE_CONFIG_DIR, no key, no credential), so Claude uses `~/.claude` and `~/.claude.json` of that folder, as in
 * the Docker sandbox, and never the host's own login.
 */

/** The file system calls the helper makes (`node:fs/promises`); tests pass fakes. */
export interface LocalFs {
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

export interface LocalHelperDeps {
  /** `spawn` of `node:child_process`; tests pass a fake. */
  readonly spawn: Spawn;
  readonly fs: LocalFs;
  /** Where the temporary homes are made (`os.tmpdir()`). */
  readonly tmpDir: string;
  /** The PATH the CLIs are found on. */
  readonly path: string;
}

/** The whole environment of a login in `home`: nothing inherited from the server. */
export function sandboxEnv(home: string, path: string): Record<string, string> {
  return {
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    PATH: path,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    NO_UPDATE_NOTIFIER: '1',
  };
}

/** The local sign-in helper. */
export function localLoginHelper(deps: LocalHelperDeps): LoginHelper {
  return {
    mode: 'local',
    async start(command) {
      const home = await deps.fs.mkdtemp(join(deps.tmpDir, 'mwc-login-'));
      const [program, ...args] = ttyArgv(command.argv) as [string, ...string[]];
      const child = deps.spawn(program, args, {
        cwd: home,
        env: sandboxEnv(home, deps.path),
        stdio: 'pipe',
      });
      return childSandbox(child, {
        readFile: (path) => deps.fs.readFile(join(home, path), 'utf8').catch(() => undefined),
        dispose: () => deps.fs.rm(home, { recursive: true, force: true }),
        notFound: 'The sign-in tools (script, claude, codex) are not installed on this server.',
      });
    },
  };
}
