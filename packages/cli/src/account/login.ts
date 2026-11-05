import { apiKeyKind, apiKeyPrefix } from '@mwc/shared/api-keys';
import type { ParsedArgs } from '../args.ts';
import { credentialsPath, normalizeServer, saveLogin } from '../credentials.ts';
import type { MainIo } from '../io.ts';
import { type Fetch, getMe, type MeMembership, userLabel } from './api.ts';
import { readKey, type SecretInput } from './secret.ts';

/** What `mwc login` reaches outside the process; `main()` passes the real ones. */
export interface AccountDeps {
  readonly fetch: Fetch;
  readonly stdin: SecretInput;
}

const USAGE =
  'usage: mwc login --server <url> --company <id|slug>  (the key from MWC_API_KEY or standard input)\n';
/** Hosts a key may reach over plain http without a warning. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const fail = (io: MainIo, message: string, code = 1) => {
  io.stderr(`mwc login: ${message}\n`);
  return code;
};

/** A key on the command line (an option, or a word that looks like one): refused, and never echoed. */
const keyAsArgument = (args: ParsedArgs) =>
  ['key', 'api-key', 'token'].some((name) => name in args.options || args.flags.has(name)) ||
  args.positionals.some((word) => word.startsWith('mwc_'));

function wrongCompany(company: string, memberships: readonly MeMembership[]): string {
  const [own] = memberships;
  if (own === undefined) return "the key's company is not available (deleted, or you are no longer a member)";
  return `this key belongs to ${own.slug} (${own.companyId}), not ${company}`;
}

/**
 * `mwc login --server <url> --company <id|slug>`: reads a personal API key from `MWC_API_KEY` or standard input
 * (never an argument), checks it with `GET /api/me` and that it belongs to that company, then saves the server, the
 * company and the key in the credentials file (`@mwc/cli/credentials`). 0 when logged in, 1 when the key or the
 * server refuses, 2 for a usage error.
 */
export async function login(args: ParsedArgs, io: MainIo, deps: AccountDeps): Promise<number> {
  if (keyAsArgument(args)) {
    const hint = 'pipe it in (pbpaste | mwc login ...) or set MWC_API_KEY';
    return fail(io, `never pass the key as an argument: it would stay in your shell history; ${hint}`, 2);
  }
  const env = io.env ?? {};
  const named = args.flags.has('server') || args.flags.has('company');
  const raw = args.options.server ?? env.MWC_SERVER;
  const company = args.options.company;
  if (named || !raw || !company) return fail(io, `--server and --company need values\n${USAGE}`, 2);
  let server: string;
  try {
    server = normalizeServer(raw);
  } catch (error) {
    return fail(io, (error as Error).message, 2);
  }
  if (server.startsWith('http://') && !LOCAL_HOSTS.has(new URL(server).hostname)) {
    io.stderr(`mwc login: warning: ${server} is plain http, so the key travels unencrypted\n`);
  }
  const key = await readKey(env, deps.stdin, io.stderr);
  if (key === undefined) return fail(io, 'no API key: set MWC_API_KEY or pipe the key in');
  if (apiKeyKind(key) !== 'personal')
    return fail(io, 'that is not a personal API key (mwc_pk_ and 32 letters or digits)');
  const result = await getMe(deps.fetch, server, key);
  if (!result.ok)
    return fail(io, result.status === 401 ? `${server} refused the key: ${result.message}` : result.message);
  const { me } = result;
  const membership = me.memberships.find((m) => m.companyId === company || m.slug === company);
  if (membership === undefined) return fail(io, wrongCompany(company, me.memberships));
  if (membership.status !== 'active')
    return fail(io, `your membership in ${membership.slug} is ${membership.status}`);
  const path = credentialsPath(env);
  try {
    saveLogin(path, { server, companyId: membership.companyId, companySlug: membership.slug, key });
  } catch (error) {
    return fail(io, `cannot save the login: ${(error as Error).message}`);
  }
  io.stdout(
    `Logged in to ${server} as ${userLabel(me.user)}\n` +
      `  company  ${membership.name} (${membership.slug}), role ${membership.role}\n` +
      `  key      ${apiKeyPrefix(key)}... saved in ${path}\n`,
  );
  return 0;
}
