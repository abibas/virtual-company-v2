import type { DbHandle, TenantDb } from '@mwc/db';
import { isSilentReply, roomReply } from '@mwc/shared/flows';
import type { SystemTurnEnd } from '../../../chats/index.ts';
import { principalNames } from '../../../org/index.ts';
import type { TasksRepo } from '../../repo.ts';
import { failureWords } from '../../rules/failure.ts';
import { postNotice, postReply } from './post.ts';

/**
 * What a flow's team room hears of a turn Most Wanted queued in an agent's room conversation when it ends (a Lead's
 * wake-up or check-in, a room turn; the chats module's `systemEnded`, through the tasks module's hook; docs/processes.md
 * "The team room"): a reply goes into the room under the agent's face unless it is silent (empty, or `NOTHING_TO_ADD`),
 * and a turn that failed says so in a notice naming the machine. A stopped turn posts nothing, nor does a turn of any
 * other chat (a step's own prompt).
 */
export async function roomTurnEnded(
  deps: { readonly db: DbHandle },
  repo: TasksRepo,
  t: TenantDb,
  end: SystemTurnEnd,
  now: Date,
): Promise<void> {
  const room = await repo.room.roomChat(t, end.chatId);
  if (room === undefined) return;
  const turn = { chatId: end.chatId, turnId: end.turnId };
  if (end.status === 'done') {
    if (isSilentReply(end.resultText)) return;
    const body = roomReply(end.resultText as string);
    const reply = { ...turn, flowId: room.flowId, agentPrincipalId: room.agentPrincipalId, body };
    await postReply(repo, t, { ...reply, replyTo: end.roomMessageId, now });
    return;
  }
  if (end.status !== 'failed') return;
  const name = (await principalNames(deps.db, t, [room.agentPrincipalId]))(room.agentPrincipalId).name;
  const machine = await repo.conversations.machineOfChat(t, end.chatId);
  const why = failureWords(end.error ?? 'The turn failed', machine);
  await postNotice(repo, t, {
    flowId: room.flowId,
    body: `${name} could not answer: ${why}`,
    about: 'failed',
    now,
    turn,
  });
}
