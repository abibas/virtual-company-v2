/**
 * The chats' queue in tests (S5.2 step 6): a message sent with a delivery, the queue's routes, the chat's detail, and a
 * running turn with its session, so the turns that start after it resume it.
 */
import type { ChatTurnDelivery } from '@mwc/shared/enums';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import type { ChatDetailView, ChatTurnView } from '../../../src/modules/chats/schemas.ts';
import type { MachinesWorld } from '../machines/world.ts';
import { as } from '../members/members.ts';
import type { Person } from '../platform/auth.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  eventRows,
  eventually,
  type Scene,
  sendEvents,
  startedTurn,
} from './world.ts';

/** Sends a prompt with a delivery as `person` (the owner by default): the status and the body. */
export const sendWith = (
  w: MachinesWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  prompt: string,
  delivery: ChatTurnDelivery,
  person?: Person,
) => as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), { prompt, delivery });

/** A message queued with a delivery (the test fails on anything but a 202): its turn. */
export async function queued(
  w: MachinesWorld,
  s: Scene,
  prompt: string,
  delivery: ChatTurnDelivery = 'after',
): Promise<ChatTurnView> {
  const res = await sendWith(w, s, prompt, delivery);
  if (res.status !== 202) throw new Error(`POST turns answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as ChatTurnView;
}

/** The chat's detail as the owner reads it. */
export async function detailOf(w: MachinesWorld, s: Scene): Promise<ChatDetailView> {
  const res = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
  return res.body as ChatDetailView;
}

/** A queued turn's own path: PATCH and DELETE, or `/deliver`. */
export const turnPath = (s: Pick<Scene, 'company' | 'chat'>, turnId: string, rest = '') =>
  chatPath(s.company, s.chat.id, `/turns/${turnId}${rest}`);

/** A running turn that said its session (the first two events of `ANSWER`), stored before the test goes on. */
export async function runningTurn(w: ChatsWorld, s: Scene): Promise<TurnStart> {
  const start = await startedTurn(w, s);
  sendEvents(s.runner as FakeRunner, start.turnId, ANSWER.slice(0, 2));
  await eventually('the session is stored', async () => (await eventRows(w.t.db, start.turnId)).length === 2);
  return start;
}
