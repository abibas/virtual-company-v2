/**
 * `mwc inbox list|count|approve|send-back` (S6b): what needs the caller now, in the company `connect` finds or across
 * their companies (`--all`; an API key acts in its own company only, so its `--all` is that company), and the two moves
 * of a Sign-off as thin wrappers over `POST …/tasks/:key/actions`. 0 when done, 1 when not logged in or refused (with
 * the server's message), 2 for a usage error.
 */
import { type CompanyCommandDeps, connect, fail } from '../account/connect.ts';
import type { ApiResult } from '../api/client.ts';
import { getInbox, getInboxCount } from '../api/inbox.ts';
import { refusal, type Session } from '../api/session.ts';
import { moveTask } from '../api/tasks.ts';
import type { ParsedArgs } from '../args.ts';
import type { MainIo } from '../io.ts';
import { companyJson } from '../org/render.ts';
import { movedText } from '../tasks/render.ts';
import { inboxText } from './render.ts';

export const INBOX_USAGE = [
  'usage: mwc inbox list [--all]',
  '       mwc inbox count [--all]',
  '       mwc inbox approve <key>',
  '       mwc inbox send-back <key> --reason <text>',
  '       (each also takes --company <slug>, --json and --server <url>)',
].join('\n');

/** The positionals each subcommand takes after its name, its options, and its flags. */
const SHAPES: Readonly<
  Record<
    string,
    { readonly words: number; readonly options: readonly string[]; readonly flags: readonly string[] }
  >
> = {
  list: { words: 0, options: [], flags: ['all'] },
  count: { words: 0, options: [], flags: ['all'] },
  approve: { words: 1, options: [], flags: [] },
  'send-back': { words: 1, options: ['reason'], flags: [] },
};

/** Why the arguments do not fit the subcommand, or undefined. */
function shapeError(args: ParsedArgs): string | undefined {
  const [sub, ...words] = args.positionals;
  const shape = sub === undefined ? undefined : SHAPES[sub];
  if (shape === undefined)
    return `expected one of ${Object.keys(SHAPES).join(', ')}${sub ? `, got "${sub}"` : ''}`;
  if (words.length !== shape.words)
    return `${sub} takes ${shape.words || 'no'} more word${shape.words === 1 ? '' : 's'}`;
  const allowed = [...shape.options, 'company', 'server'];
  const bare = allowed.find((name) => args.flags.has(name));
  if (bare !== undefined) return `--${bare} needs a value`;
  const unknown = Object.keys(args.options).find((name) => !allowed.includes(name));
  if (unknown !== undefined) return `${sub} does not take --${unknown}`;
  const flag = [...args.flags].find((name) => ![...shape.flags, 'json'].includes(name));
  return flag === undefined ? undefined : `${sub} does not take --${flag}`;
}

/** Prints the body (as JSON with the company when asked); 0, or 1 with the server's refusal. */
function print<T>(
  io: MainIo,
  run: { readonly command: string; readonly args: ParsedArgs; readonly session: Session },
  result: ApiResult<T>,
  text: (body: T) => string,
): number {
  if (!result.ok) return fail(io, run.command, refusal(run.session.server, result));
  if (run.args.flags.has('json')) {
    io.stdout(
      `${JSON.stringify({ company: companyJson(run.session.company), result: result.body }, null, 2)}\n`,
    );
  } else {
    io.stdout(text(result.body));
  }
  return 0;
}

/** `mwc inbox list|count|approve|send-back …`. */
export async function inboxCommand(args: ParsedArgs, io: MainIo, deps: CompanyCommandDeps): Promise<number> {
  const usage = shapeError(args);
  if (usage !== undefined) return fail(io, 'mwc inbox', `${usage}\n${INBOX_USAGE}`, 2);
  const [sub, key = ''] = args.positionals as [string, string?];
  const command = `mwc inbox ${sub}`;
  const reason = args.options.reason;
  if (sub === 'send-back' && (reason === undefined || reason.trim() === ''))
    return fail(io, command, `--reason is needed\n${INBOX_USAGE}`, 2);
  const session = await connect(command, args, io, deps);
  if (typeof session === 'number') return session;
  const { server, company } = session;
  const run = { command, args, session };
  const scope = { companyId: company.companyId, all: args.flags.has('all') };
  if (sub === 'list') {
    const inbox = await getInbox(deps.fetch, server, session.key, scope);
    return print(io, run, inbox, (body) => inboxText(body.items, scope.all ? undefined : company.name));
  }
  if (sub === 'count') {
    const count = await getInboxCount(deps.fetch, server, session.key, scope);
    return print(io, run, count, (body) => `${body.count}\n`);
  }
  const body = sub === 'approve' ? { action: 'approve' } : { action: 'send_back', reason };
  const moved = await moveTask(deps.fetch, server, session.key, company.companyId, key, body);
  return print(io, run, moved, movedText);
}
