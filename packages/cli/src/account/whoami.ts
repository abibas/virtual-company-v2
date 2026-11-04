import { apiKeyKind, apiKeyPrefix } from '@mwc/shared/api-keys';
import type { ParsedArgs } from '../args.ts';
import { type ActiveLogin, credentialsPath, readCredentials, resolveLogin } from '../credentials.ts';
import type { MainIo } from '../io.ts';
import { getMe } from './api.ts';
import type { AccountDeps } from './login.ts';

const fail = (io: MainIo, message: string, code = 1) => {
  io.stderr(`mwc whoami: ${message}\n`);
  return code;
};

const NOT_LOGGED_IN = 'Run mwc login --server <url> --company <id|slug>, or set MWC_SERVER and MWC_API_KEY.';

/**
 * `mwc whoami [--server <url>]`: the user, company, role and key prefix behind the saved login (or `MWC_SERVER` and
 * `MWC_API_KEY`, which take precedence), from `GET /api/me`. Never prints the key. 1 when not logged in or when the
 * server refuses the key.
 */
export async function whoami(
  args: ParsedArgs,
  io: MainIo,
  deps: Pick<AccountDeps, 'fetch'>,
): Promise<number> {
  const env = io.env ?? {};
  if (args.flags.has('server')) return fail(io, '--server needs a value', 2);
  const path = credentialsPath(env);
  let active: ActiveLogin | undefined;
  try {
    active = resolveLogin(env, readCredentials(path), args.options.server);
  } catch (error) {
    return fail(io, (error as Error).message);
  }
  if (active === undefined) return fail(io, `not logged in. ${NOT_LOGGED_IN}`);
  const from = active.source === 'env' ? 'from MWC_API_KEY' : `saved in ${path}`;
  if (apiKeyKind(active.key) !== 'personal') return fail(io, `the key ${from} is not a personal API key`);
  const result = await getMe(deps.fetch, active.server, active.key);
  if (!result.ok && result.status === 401) {
    return fail(
      io,
      `${active.server} refused the key (${result.message}). Make a new key and run mwc login again.`,
    );
  }
  if (!result.ok) return fail(io, result.message);
  const { me } = result;
  const companyId = active.saved?.companyId;
  const membership = me.memberships.find((m) => m.companyId === companyId) ?? me.memberships[0];
  if (membership === undefined) {
    return fail(io, "the key's company is not available any more (deleted, or you are no longer a member)");
  }
  const status = membership.status === 'active' ? '' : ` (${membership.status})`;
  io.stdout(
    `server   ${active.server}\n` +
      `user     ${me.user.displayName} <${me.user.email}>\n` +
      `company  ${membership.name} (${membership.slug}, ${membership.companyId})\n` +
      `role     ${membership.role}${status}\n` +
      `key      ${apiKeyPrefix(active.key)}... (${from})\n`,
  );
  return 0;
}
