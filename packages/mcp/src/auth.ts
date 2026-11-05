/**
 * Which server and key the tools use, read again on every call, so a new `mwc login` needs no restart of Claude Code:
 * `MWC_API_KEY` with `MWC_SERVER_URL` (or the CLI's `MWC_SERVER`) when the environment sets them, else the saved login
 * of `mwc login` (`@mwc/cli/credentials`: `MWC_CONFIG_DIR`, else `$XDG_CONFIG_HOME/mwc`, else ~/.config/mwc).
 */
import type { Outcome } from '@mwc/cli/api/session';
import {
  type ActiveLogin,
  credentialsPath,
  EMPTY_CREDENTIALS,
  readCredentials,
  resolveLogin,
} from '@mwc/cli/credentials';

export type Env = Readonly<Record<string, string | undefined>>;

export const NOT_LOGGED_IN =
  'Not logged in to Most Wanted Corp. Run `mwc login --server <url> --company <slug>` in a terminal (it saves a ' +
  'personal API key), or set MWC_SERVER_URL and MWC_API_KEY in the environment of this MCP server.';

/** The login the tools use now, or why there is none (not logged in, a broken credentials file, a bad server URL). */
export function resolveAuth(env: Env): Outcome<ActiveLogin> {
  const server = env.MWC_SERVER_URL || env.MWC_SERVER;
  const scoped = { ...env, MWC_SERVER: server };
  try {
    // With both in the environment the file is not read at all, so a broken one cannot get in the way.
    const file = server && env.MWC_API_KEY ? EMPTY_CREDENTIALS : readCredentials(credentialsPath(env));
    const login = resolveLogin(scoped, file);
    return login === undefined ? { ok: false, message: NOT_LOGGED_IN } : { ok: true, value: login };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
