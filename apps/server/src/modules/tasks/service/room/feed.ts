import type { RoomMessage, TenantDb } from '@mwc/db';
import { ROOM_PAGE, taskKey } from '@mwc/shared/flows';
import type { RoomCursor, RoomTurnNow } from '../../repo/room.ts';
import type { TasksRepo } from '../../repo.ts';
import { mayWrite } from '../../rules/room.ts';
import { HOUR_MS } from '../../rules/wake.ts';
import { FLOW_NOT_FOUND, type Refusal } from '../../rules.ts';
import type { RoomMessageView, RoomQuery, RoomView } from '../../schemas/room.ts';
import type { Caller } from '../audit.ts';
import type { Names } from '../team.ts';
import { type RoomDeps, roomContext } from './members.ts';

/**
 * A flow's team room as everyone of the company reads it (docs/processes.md "The team room"): a page of its feed with
 * each message's author, a step-end line's task and move, who is in the room and whether the caller writes there, the
 * agents with a room turn waiting or running, and the room's cap with the answers asked in the last hour.
 */

/** A cursor as the page gives it (`<time>_<id>`); undefined for none or one that does not read. */
export function readCursor(text: string | undefined): RoomCursor | undefined {
  const match = text === undefined ? null : /^(\d+)_([0-9a-f-]{36})$/.exec(text);
  return match === null ? undefined : { at: new Date(Number(match[1])), id: match[2] as string };
}

const cursorOf = (row: RoomMessage) => `${row.createdAt.getTime()}_${row.id}`;

type Tasks = ReadonlyMap<string, { readonly key: string; readonly title: string }>;

/** One message as the feed shows it. */
function messageView(row: RoomMessage, names: Names, tasks: Tasks): RoomMessageView {
  const details = row.details as Record<string, unknown>;
  const task = row.taskId === null ? undefined : tasks.get(row.taskId);
  return {
    id: row.id,
    kind: row.kind,
    author: row.authorPrincipalId === null ? null : names(row.authorPrincipalId),
    body: row.body,
    at: row.createdAt.toISOString(),
    task: task === undefined || row.taskId === null ? null : { id: row.taskId, ...task },
    step: row.kind === 'step_end' ? (details as RoomMessageView['step']) : null,
    to: Array.isArray(details.to) ? (details.to as string[]) : [],
    asked: row.asked,
    chatId: row.chatId,
    turnId: row.turnId,
  };
}

/** One entry per agent with a room turn waiting or running: its running one, else its first waiting one. */
function replyingOf(busy: readonly RoomTurnNow[]): RoomView['replying'] {
  const byAgent = new Map<string, RoomTurnNow>();
  for (const turn of busy) {
    const seen = byAgent.get(turn.agentPrincipalId);
    if (seen === undefined || (seen.status === 'queued' && turn.status === 'running'))
      byAgent.set(turn.agentPrincipalId, turn);
  }
  return [...byAgent.values()].map(({ agentPrincipalId, status, machineWait }) => ({
    principalId: agentPrincipalId,
    status,
    machineWait,
  }));
}

/** The room's page (see above), as the caller sees it at `now`. */
export async function roomFeed(
  deps: RoomDeps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Pick<Caller, 'principalId' | 'role'>,
  read: { readonly flowId: string; readonly query: RoomQuery; readonly now: Date },
): Promise<{ readonly ok: true; readonly room: RoomView } | Refusal<404>> {
  const flow = await repo.flows.get(t, read.flowId);
  if (flow === undefined) return FLOW_NOT_FOUND;
  const limit = read.query.limit ?? ROOM_PAGE.default;
  const rows = await repo.room.page(t, flow.id, limit + 1, readCursor(read.query.before));
  const page = rows.length > limit ? rows.slice(1) : rows;
  const room = await roomContext(
    deps,
    repo,
    t,
    flow,
    page.map((row) => row.authorPrincipalId),
  );
  const taskIds = [...new Set(page.flatMap((row) => (row.taskId === null ? [] : [row.taskId])))];
  const tasks = new Map(
    (await repo.room.tasksOf(t, taskIds)).map((row) => [
      row.id,
      { key: taskKey(row.number), title: row.title },
    ]),
  );
  const busy = await repo.room.busy(t, flow.id);
  const askedLastHour = await repo.room.askedSince(t, flow.id, new Date(read.now.getTime() - HOUR_MS));
  return {
    ok: true,
    room: {
      flow: { id: flow.id, name: flow.name, leadPrincipalId: flow.leadPrincipalId },
      members: { agents: room.members.agents.map(room.names), people: room.members.people.map(room.names) },
      mayWrite: mayWrite(caller, room.members),
      messages: page.map((row) => messageView(row, room.names, tasks)),
      nextBefore: rows.length > limit && page[0] !== undefined ? cursorOf(page[0]) : null,
      replying: replyingOf(busy),
      cap: { maxPerHour: flow.roomMaxPerHour, askedLastHour },
    },
  };
}
