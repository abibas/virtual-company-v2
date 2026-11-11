/**
 * `mwc task create|list|show|move` and `mwc flow show` (S5.3a): a team's tasks moved by hand, and a flow's written
 * form, in the login and company `connect` finds (`account/connect.ts`). A flow is named by its Lead (an agent's slug,
 * a principal id or a name) or by itself (its id or name); a step by its name or id. 0 when done, 1 when not logged in
 * or refused (with the server's message), 2 for a usage error.
 */
import { TaskAction, TaskPriority, TaskState } from '@mwc/shared/enums';
import { type CompanyCommandDeps, connect, fail } from '../account/connect.ts';
import type { ApiResult } from '../api/client.ts';
import { refusal, type Session } from '../api/session.ts';
import {
  createTask,
  type FlowSummary,
  getFlow,
  getFlowText,
  getTask,
  listFlows,
  listTasks,
  moveTask,
} from '../api/tasks.ts';
import type { ParsedArgs } from '../args.ts';
import type { MainIo } from '../io.ts';
import { companyJson } from '../org/render.ts';
import { movedText, standing, tasksText, taskText } from './render.ts';

export const TASK_USAGE = [
  'usage: mwc task create --flow <lead|flow> --title <title> [--step <step>] [--description <text>]',
  '                       [--priority low|normal|high|urgent]',
  '       mwc task list [--flow <lead|flow>] [--state queued|active|escalated|done|cancelled]',
  '       mwc task show <key>',
  `       mwc task move <key> <${TaskAction.options.join('|')}> [--to <step>] [--reason <text>]`,
  '       (each also takes --company <slug>, --json and --server <url>)',
].join('\n');
export const FLOW_USAGE = 'usage: mwc flow show <lead|flow> [--company <slug>] [--json] [--server <url>]';

/** The positionals each subcommand takes after its name, and the options it takes. */
const SHAPES: Readonly<Record<string, { readonly words: number; readonly options: readonly string[] }>> = {
  create: { words: 0, options: ['flow', 'title', 'step', 'description', 'priority'] },
  list: { words: 0, options: ['flow', 'state'] },
  show: { words: 1, options: [] },
  move: { words: 2, options: ['to', 'reason'] },
};

/** Why the arguments do not fit the subcommand, or undefined. */
function shapeError(args: ParsedArgs, shapes: typeof SHAPES): string | undefined {
  const [sub, ...words] = args.positionals;
  const shape = sub === undefined ? undefined : shapes[sub];
  if (shape === undefined)
    return `expected one of ${Object.keys(shapes).join(', ')}${sub ? `, got "${sub}"` : ''}`;
  if (words.length !== shape.words)
    return `${sub} takes ${shape.words || 'no'} more word${shape.words === 1 ? '' : 's'}`;
  const allowed = [...shape.options, 'company', 'server'];
  const bare = allowed.find((name) => args.flags.has(name));
  if (bare !== undefined) return `--${bare} needs a value`;
  const unknown = Object.keys(args.options).find((name) => !allowed.includes(name));
  return unknown === undefined ? undefined : `${sub} does not take --${unknown}`;
}

/** The flow a reference names: its id or name, or its Lead's principal id, slug or name (any case). */
export function findFlow(flows: readonly FlowSummary[], ref: string): FlowSummary | string {
  const wanted = ref.trim().toLowerCase();
  const matches = flows.filter((flow) =>
    [flow.id, flow.name, flow.lead.principalId, flow.lead.slug ?? '', flow.lead.name].some(
      (name) => name.toLowerCase() === wanted,
    ),
  );
  if (matches.length === 1) return matches[0] as FlowSummary;
  const known = flows.map((flow) => `${flow.name} (Lead ${flow.lead.slug ?? flow.lead.name})`).join(', ');
  if (matches.length > 1) return `"${ref}" names several flows; use the flow's id`;
  return `no flow for "${ref}"; the company has ${known || 'none yet'}`;
}

/** Prints the body (as JSON with the company, under `name`, when asked); 0, or 1 with the server's refusal. */
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

/** The flow `ref` names in the session's company, or the exit code after saying why not. */
async function flowOf(io: MainIo, command: string, deps: CompanyCommandDeps, session: Session, ref: string) {
  const flows = await listFlows(deps.fetch, session.server, session.key, session.company.companyId);
  if (!flows.ok) return fail(io, command, refusal(session.server, flows));
  const found = findFlow(flows.body, ref);
  return typeof found === 'string' ? fail(io, command, found) : found;
}

/** The id of the flow's step `ref` names (its name in any case, or its id), or the exit code after saying why not. */
async function stepOf(
  io: MainIo,
  command: string,
  deps: CompanyCommandDeps,
  session: Session,
  flowId: string,
  ref: string,
) {
  const flow = await getFlow(deps.fetch, session.server, session.key, session.company.companyId, flowId);
  if (!flow.ok) return fail(io, command, refusal(session.server, flow));
  const wanted = ref.trim().toLowerCase();
  const step = flow.body.steps.find((s) => s.id === ref || s.name.toLowerCase() === wanted);
  if (step) return step.id;
  return fail(
    io,
    command,
    `no step "${ref}" in ${flow.body.name}; its steps: ${flow.body.steps.map((s) => s.name).join(', ')}`,
  );
}

/** Checks an option's value against an enum's; the message, or undefined. */
const notOneOf = (name: string, value: string | undefined, options: readonly string[]) =>
  value === undefined || options.includes(value)
    ? undefined
    : `--${name} must be one of ${options.join(', ')}, not "${value}"`;

async function create(
  io: MainIo,
  args: ParsedArgs,
  deps: CompanyCommandDeps,
  session: Session,
): Promise<number> {
  const command = 'mwc task create';
  const { flow: ref, title, step, description, priority } = args.options;
  if (ref === undefined || title === undefined)
    return fail(io, command, `--flow and --title are needed\n${TASK_USAGE}`, 2);
  const bad = notOneOf('priority', priority, TaskPriority.options);
  if (bad) return fail(io, command, bad, 2);
  const flow = await flowOf(io, command, deps, session, ref);
  if (typeof flow === 'number') return flow;
  const stepId = step === undefined ? undefined : await stepOf(io, command, deps, session, flow.id, step);
  if (typeof stepId === 'number') return stepId;
  const body = { flowId: flow.id, title, description, priority, stepId };
  const made = await createTask(deps.fetch, session.server, session.key, session.company.companyId, body);
  const run = { command, args, session };
  return print(io, run, made, (task) => `${task.key} created in ${task.flow.name}: ${standing(task)}\n`);
}

async function list(
  io: MainIo,
  args: ParsedArgs,
  deps: CompanyCommandDeps,
  session: Session,
): Promise<number> {
  const command = 'mwc task list';
  const { flow: ref, state } = args.options;
  const bad = notOneOf('state', state, TaskState.options);
  if (bad) return fail(io, command, bad, 2);
  const flow = ref === undefined ? undefined : await flowOf(io, command, deps, session, ref);
  if (typeof flow === 'number') return flow;
  const filter = { flowId: flow?.id, state };
  const tasks = await listTasks(deps.fetch, session.server, session.key, session.company.companyId, filter);
  const where = `${state === undefined ? '' : `${state} `}in ${flow?.name ?? session.company.name}`.trim();
  return print(io, { command, args, session }, tasks, (body) => tasksText(body, where));
}

async function move(
  io: MainIo,
  args: ParsedArgs,
  deps: CompanyCommandDeps,
  session: Session,
): Promise<number> {
  const command = 'mwc task move';
  const [, key = '', action = ''] = args.positionals;
  const bad = notOneOf('action', action, TaskAction.options);
  if (bad) return fail(io, command, bad.replace('--action', 'the action'), 2);
  const { to, reason } = args.options;
  let toStepId: string | undefined;
  if (to !== undefined) {
    const task = await getTask(deps.fetch, session.server, session.key, session.company.companyId, key);
    if (!task.ok) return fail(io, command, refusal(session.server, task));
    const found = await stepOf(io, command, deps, session, task.body.flow.id, to);
    if (typeof found === 'number') return found;
    toStepId = found;
  }
  const body = { action, toStepId, reason };
  const moved = await moveTask(deps.fetch, session.server, session.key, session.company.companyId, key, body);
  return print(io, { command, args, session }, moved, movedText);
}

/** `mwc task create|list|show|move …`. */
export async function taskCommand(args: ParsedArgs, io: MainIo, deps: CompanyCommandDeps): Promise<number> {
  const usage = shapeError(args, SHAPES);
  if (usage !== undefined) return fail(io, 'mwc task', `${usage}\n${TASK_USAGE}`, 2);
  const sub = args.positionals[0] as string;
  const session = await connect(`mwc task ${sub}`, args, io, deps);
  if (typeof session === 'number') return session;
  if (sub === 'create') return create(io, args, deps, session);
  if (sub === 'list') return list(io, args, deps, session);
  if (sub === 'move') return move(io, args, deps, session);
  const task = await getTask(
    deps.fetch,
    session.server,
    session.key,
    session.company.companyId,
    args.positionals[1] as string,
  );
  return print(io, { command: 'mwc task show', args, session }, task, taskText);
}

/** `mwc flow show <lead|flow>`: the flow's written form, or with `--json` the flow and its steps. */
export async function flowCommand(args: ParsedArgs, io: MainIo, deps: CompanyCommandDeps): Promise<number> {
  const usage = shapeError(args, { show: { words: 1, options: [] } });
  if (usage !== undefined) return fail(io, 'mwc flow', `${usage}\n${FLOW_USAGE}`, 2);
  const command = 'mwc flow show';
  const session = await connect(command, args, io, deps);
  if (typeof session === 'number') return session;
  const flow = await flowOf(io, command, deps, session, args.positionals[1] as string);
  if (typeof flow === 'number') return flow;
  const { server, key, company } = session;
  const run = { command, args, session };
  if (args.flags.has('json'))
    return print(io, run, await getFlow(deps.fetch, server, key, company.companyId, flow.id), String);
  return print(
    io,
    run,
    await getFlowText(deps.fetch, server, key, company.companyId, flow.id),
    (text) => text,
  );
}
