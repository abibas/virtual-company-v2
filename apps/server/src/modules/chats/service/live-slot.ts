import type { ChatTurn, TenantDb } from '@mwc/db';
import type { TurnEnding } from '../../machines/index.ts';
import { turnsRepo } from '../repo/turns.ts';
import type { ChatBus } from './bus.ts';
import { turnView } from './views.ts';

/**
 * A live turn the runner refused because every slot of its machine was taken (`busy`; the server counted fewer turns
 * there, `live.ts`): it waits for a free slot instead of ending (docs/harness.md "Waiting for a free slot"), since when
 * it first waited for one. No end is told: not to a task, not to the queue (a turn ending on the machine starts it).
 */

/** The runner's refusal of a turn while every slot of the machine is taken (`turn.end.error`). */
const BUSY = 'busy';

/** What putting a turn back to waiting needs of the live turns. */
export interface SlotHold {
  readonly bus: ChatBus;
  readonly clock: () => Date;
  /** What runs once the turn waits for a slot (its wait is watched); none: the turn ends as any failure does. */
  readonly busy?: ((t: TenantDb, turn: ChatTurn) => Promise<void>) | undefined;
}

/** True when the turn's end was a full machine's refusal and the turn now waits for a slot; false otherwise. */
export async function heldForSlot(
  hold: SlotHold,
  t: TenantDb,
  turn: ChatTurn,
  ending: TurnEnding,
): Promise<boolean> {
  if (ending.ok || ending.error !== BUSY || hold.busy === undefined) return false;
  const since = turn.machineWait === 'slots' ? turn.machineWaitAt : null;
  const set = { status: 'queued', delivery: 'after', startedAt: null, machineWait: 'slots' } as const;
  const row = await turnsRepo.updateLive(t, turn.id, { ...set, machineWaitAt: since ?? hold.clock() });
  if (row === undefined) return false;
  hold.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(row) });
  await hold.busy(t, row);
  return true;
}
