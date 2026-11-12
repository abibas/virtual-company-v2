/**
 * The team room's tests helpers: its API paths, a person's message, the room as stored, and the runner's side of the
 * agents' room turns (each `turn.start` told apart by the agent whose room conversation it is). The scene is the Lead
 * wake-ups' (`wakeScene`: the Lead and the Developer placed on an online machine). Never a real CLI: the runner is the
 * fake.
 */
import { agents, chats, type DbHandle, roomMessages } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { asc, eq } from 'drizzle-orm';
import type { RoomView } from '../../src/modules/tasks/schemas/room.ts';
import { turnRow } from './chats/world.ts';
import { as } from './members/members.ts';
import type { Person } from './platform/auth.ts';
import { flowsPath } from './tasks.ts';
import type { WakeScene, WakeWorld } from './wakes.ts';

export type { RoomView };

/** The room's path of the scene's flow. */
export const roomPath = (s: WakeScene, rest = '') => flowsPath(s.c, `/${s.flow.id}/room${rest}`);

/** A person writes in the room: the response as the API answers it. */
export const say = (w: WakeWorld, s: WakeScene, by: Person, body: string) =>
  as(w, by)('POST', roomPath(s, '/messages'), { body });

/** A person writes in the room, which must take it: the room after it. */
export async function said(w: WakeWorld, s: WakeScene, by: Person, body: string): Promise<RoomView> {
  const res = await say(w, s, by, body);
  if (res.status !== 201) throw new Error(`POST room/messages answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as RoomView;
}

/** The room as `by` reads it. */
export async function roomOf(w: WakeWorld, s: WakeScene, by: Person, query = ''): Promise<RoomView> {
  const res = await as(w, by)('GET', roomPath(s, query));
  if (res.status !== 200) throw new Error(`GET room answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as RoomView;
}

/** The room's messages as stored, in the feed's order. */
export const roomRows = (db: DbHandle, flowId: string) =>
  rawDb(db)
    .select()
    .from(roomMessages)
    .where(eq(roomMessages.flowId, flowId))
    .orderBy(asc(roomMessages.createdAt), asc(roomMessages.id));

/** The room's messages as `[kind, author, body]`. */
export const roomLines = async (db: DbHandle, flowId: string) =>
  (await roomRows(db, flowId)).map((row) => [row.kind, row.authorPrincipalId, row.body] as const);

/** The agent's room conversation (its chat of the flow), if it has one. */
export async function roomChatOf(db: DbHandle, flowId: string, agentPrincipalId: string) {
  const [agent] = await rawDb(db).select().from(agents).where(eq(agents.principalId, agentPrincipalId));
  const rows = await rawDb(db).select().from(chats).where(eq(chats.flowId, flowId));
  return rows.find((chat) => chat.agentId === agent?.id);
}

/** The agent principal whose chat a started turn is in. */
async function agentOfTurn(db: DbHandle, turnId: string): Promise<string> {
  const turn = await turnRow(db, turnId);
  const [chat] = await rawDb(db).select().from(chats).where(eq(chats.id, turn?.chatId as string));
  const [agent] = await rawDb(db).select().from(agents).where(eq(agents.id, chat?.agentId as string));
  return agent?.principalId as string;
}

/** The next `count` turns the runner starts, by the agent whose chat each is in. */
export async function startsByAgent(w: WakeWorld, s: WakeScene, count: number): Promise<Map<string, TurnStart>> {
  const starts = new Map<string, TurnStart>();
  for (let i = 0; i < count; i++) {
    const start = await s.runner.frames.next('turn.start');
    starts.set(await agentOfTurn(w.t.db, start.turnId), start);
  }
  return starts;
}
