/**
 * The branch tests' steps (docs/harness.md "Branching"): a turn answered with the events given (a session, a reply, a
 * result with or without its last message id), a branch asked for as an admin or another person, and a chat of the
 * scene seen as another (a branch), so the world's turn steps run on it.
 */
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import type { ChatView } from '../../../src/modules/chats/schemas.ts';
import { as } from '../members/members.ts';
import type { Person } from '../platform/auth.ts';
import { type ChatsWorld, chatPath, ended, endTurn, type Scene, sendEvents, startedTurn } from './world.ts';

/** The parent's session in these tests. */
export const PARENT_SESSION = 'b4c1f0e2-session';

/** A whole reply on `session`, its result naming `messageId` when given. */
export function reply(text: string, messageId?: string, session = PARENT_SESSION): TurnEvent[] {
  return [
    { type: 'session', sessionId: session },
    { type: 'text', text },
    { type: 'result', ok: true, text, ...(messageId === undefined ? {} : { messageId }) },
  ];
}

/** A prompt answered with `events` and ended: its `turn.start`. */
export async function answeredTurn(
  w: ChatsWorld,
  s: Scene,
  events: readonly TurnEvent[],
  prompt = 'What is 2 + 2?',
): Promise<TurnStart> {
  const start = await startedTurn(w, s, prompt);
  const runner = s.runner as FakeRunner;
  sendEvents(runner, start.turnId, events);
  endTurn(runner, start.turnId);
  await ended(w.t.db, start.turnId);
  return start;
}

/** Asks for a branch of the scene's chat from `turnId`, as `person` (the owner by default): the status and the body. */
export const branch = (w: ChatsWorld, s: Pick<Scene, 'company' | 'chat'>, turnId: string, person?: Person) =>
  as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/branch'), { turnId });

/** A branch made (the test fails on anything but a 201). */
export async function branched(w: ChatsWorld, s: Scene, turnId: string): Promise<ChatView> {
  const res = await branch(w, s, turnId);
  if (res.status !== 201) throw new Error(`POST branch answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as ChatView;
}

/** The scene with another of its chats open (a branch), for the world's turn steps. */
export const onChat = (s: Scene, chat: ChatView): Scene => ({ ...s, chat });

/** The code of a refusal, with its status. */
export const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];
