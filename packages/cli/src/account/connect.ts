/**
 * What the commands that act in a company share (`mwc org`, `mwc agents`, `mwc machine`): their usage check, their
 * failure line, and the login and company they act in (`connect`).
 */
import type { Fetch } from '../api/client.ts';
import { openSession, type Session } from '../api/session.ts';
import type { ParsedArgs } from '../args.ts';
import { credentialsPath, readCredentials, resolveLogin } from '../credentials.ts';
import type { MainIo } from '../io.ts';

/** What these commands reach outside the process: the API, through fetch. */
export interface CompanyCommandDeps {
  readonly fetch: Fetch;
}

const NOT_LOGGED_IN =
  'not logged in. Run mwc login --server <url> --company <id|slug>, or set MWC_SERVER and MWC_API_KEY.';

/** Says `<command>: <message>` on stderr; returns the exit code (1 unless given). */
export function fail(io: MainIo, command: string, message: string, code = 1): number {
  io.stderr(`${command}: ${message}\n`);
  return code;
}

/**
 * A usage error, or undefined: the subcommand is not `sub` (or more words follow), or one of `options` is given
 * without a value.
 */
export function usageError(args: ParsedArgs, sub: string, options: readonly string[]): string | undefined {
  const [word, ...rest] = args.positionals;
  if (word !== sub || rest.length > 0)
    return `expected "${sub}"${word === undefined ? '' : `, got "${args.positionals.join(' ')}"`}`;
  const bare = options.find((name) => args.flags.has(name));
  return bare === undefined ? undefined : `--${bare} needs a value`;
}

/**
 * The login (`--server`, else `MWC_SERVER`, else the current one; `MWC_API_KEY`, else the saved key) and the company
 * (`--company`, else the saved login's, else the only one), checked with `GET /api/me`; or the exit code after saying
 * why not (1).
 */
export async function connect(
  command: string,
  args: ParsedArgs,
  io: MainIo,
  deps: CompanyCommandDeps,
): Promise<Session | number> {
  const env = io.env ?? {};
  let login: ReturnType<typeof resolveLogin>;
  try {
    login = resolveLogin(env, readCredentials(credentialsPath(env)), args.options.server);
  } catch (error) {
    return fail(io, command, (error as Error).message);
  }
  if (login === undefined) return fail(io, command, NOT_LOGGED_IN);
  const opened = await openSession(deps.fetch, login, {
    company: args.options.company,
    hint: '--company <slug>',
  });
  return opened.ok ? opened.value : fail(io, command, opened.message);
}
