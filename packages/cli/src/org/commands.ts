/**
 * `mwc org tree` and `mwc agents list`: their usage checks, the login and the company they act in (`connect`), and the
 * two commands. 0 when printed, 1 when not logged in or refused (with the server's message), 2 for a usage error.
 */
import type { Fetch } from '../api/client.ts';
import { AGENT_FILTERS, getChart, listAgents } from '../api/org.ts';
import { openSession, refusal, type Session } from '../api/session.ts';
import type { ParsedArgs } from '../args.ts';
import { credentialsPath, readCredentials, resolveLogin } from '../credentials.ts';
import type { MainIo } from '../io.ts';
import { agentsText, chartText, companyJson, principalNames } from './render.ts';

/** What the org commands reach outside the process: the API, through fetch. */
export interface OrgDeps {
  readonly fetch: Fetch;
}

export const ORG_USAGE = 'usage: mwc org tree [--company <slug>] [--json] [--server <url>]';
export const AGENTS_USAGE =
  'usage: mwc agents list [--company <slug>] [--status active|paused|archived|all] [--json] [--server <url>]';

const NOT_LOGGED_IN =
  'not logged in. Run mwc login --server <url> --company <id|slug>, or set MWC_SERVER and MWC_API_KEY.';

/** Says `<command>: <message>` on stderr; returns the exit code (1 unless given). */
function fail(io: MainIo, command: string, message: string, code = 1): number {
  io.stderr(`${command}: ${message}\n`);
  return code;
}

/**
 * A usage error, or undefined: the subcommand is not `sub` (or more words follow), or one of `options` is given
 * without a value.
 */
function usageError(args: ParsedArgs, sub: string, options: readonly string[]): string | undefined {
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
async function connect(
  command: string,
  args: ParsedArgs,
  io: MainIo,
  deps: OrgDeps,
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

/**
 * `mwc org tree [--company <slug>] [--json] [--server <url>]`: the company's org chart from
 * `GET /api/companies/:companyId/org/chart`, as an indented tree (`chartText`) or, with `--json`, the company and the
 * chart's nodes and tree as the API gives them.
 */
export async function orgCommand(args: ParsedArgs, io: MainIo, deps: OrgDeps): Promise<number> {
  const usage = usageError(args, 'tree', ['company', 'server']);
  if (usage !== undefined) return fail(io, 'mwc org', `${usage}\n${ORG_USAGE}`, 2);
  const command = 'mwc org tree';
  const session = await connect(command, args, io, deps);
  if (typeof session === 'number') return session;
  const chart = await getChart(deps.fetch, session.server, session.key, session.company.companyId);
  if (!chart.ok) return fail(io, command, refusal(session.server, chart));
  if (args.flags.has('json')) {
    io.stdout(`${JSON.stringify({ company: companyJson(session.company), ...chart.body }, null, 2)}\n`);
  } else {
    io.stdout(chartText(session.company, chart.body));
  }
  return 0;
}

/**
 * `mwc agents list [--company <slug>] [--status <status>|all] [--json] [--server <url>]`: the company's agents from
 * `GET /api/companies/:companyId/agents` (the active and paused ones unless `--status` says), with whom each reports
 * to by name from the org chart, as an aligned table (`agentsText`) or, with `--json`, the company and the agents as
 * the API gives them plus `reportsToName`.
 */
export async function agentsCommand(args: ParsedArgs, io: MainIo, deps: OrgDeps): Promise<number> {
  const usage = usageError(args, 'list', ['company', 'server', 'status']);
  if (usage !== undefined) return fail(io, 'mwc agents', `${usage}\n${AGENTS_USAGE}`, 2);
  const command = 'mwc agents list';
  const { status } = args.options;
  if (status !== undefined && !AGENT_FILTERS.includes(status)) {
    return fail(io, command, `--status must be one of ${AGENT_FILTERS.join(', ')}, not "${status}"`, 2);
  }
  const session = await connect(command, args, io, deps);
  if (typeof session === 'number') return session;
  const { server, key, company } = session;
  const [agents, chart] = await Promise.all([
    listAgents(deps.fetch, server, key, company.companyId, status),
    getChart(deps.fetch, server, key, company.companyId),
  ]);
  if (!agents.ok) return fail(io, command, refusal(server, agents));
  if (!chart.ok) return fail(io, command, refusal(server, chart));
  if (args.flags.has('json')) {
    const names = principalNames(chart.body);
    const listed = agents.body.map((a) => ({ ...a, reportsToName: names.get(a.reportsTo ?? '') ?? null }));
    io.stdout(`${JSON.stringify({ company: companyJson(company), agents: listed }, null, 2)}\n`);
  } else {
    io.stdout(agentsText(company, agents.body, chart.body, status));
  }
  return 0;
}
