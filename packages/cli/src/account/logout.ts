import type { ParsedArgs } from '../args.ts';
import { credentialsPath, normalizeServer, readCredentials, removeLogin } from '../credentials.ts';
import type { MainIo } from '../io.ts';

/**
 * `mwc logout [--server <url>]`: removes the login of the server named, else of `MWC_SERVER`, else of the current
 * one, from the credentials file. Not logged in is not an error. The key itself stays valid until it expires or is
 * revoked (`DELETE /api/companies/:companyId/api-keys/:keyId`).
 */
export function logout(args: ParsedArgs, io: MainIo): number {
  const env = io.env ?? {};
  if (args.flags.has('server')) {
    io.stderr('mwc logout: --server needs a value\n');
    return 2;
  }
  const path = credentialsPath(env);
  try {
    const raw = args.options.server ?? (env.MWC_SERVER || readCredentials(path).current);
    if (raw === undefined) {
      io.stdout('Not logged in; nothing to remove.\n');
      return 0;
    }
    const server = normalizeServer(raw);
    if (!removeLogin(path, server)) {
      io.stdout(`Not logged in to ${server}; nothing to remove.\n`);
      return 0;
    }
    io.stdout(
      `Logged out of ${server}: its key is removed from ${path}.\n` +
        'The key still works until it expires; revoke it from your API keys if it may have leaked.\n',
    );
    return 0;
  } catch (error) {
    io.stderr(`mwc logout: ${(error as Error).message}\n`);
    return 1;
  }
}
