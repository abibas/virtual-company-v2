import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import type { Logger } from 'pino';
import type { RunnerHub } from '../../machines/index.ts';
import { queueRepo } from '../repo/queue.ts';
import { slotsRepo } from '../repo/slots.ts';
import { chatsRepo } from '../repo.ts';
import { type MachineSlots, noSlotText, slotFree } from '../rules/machine.ts';
import type { Refusal } from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import type { ChatsLive } from './live.ts';
import { type MachineWaits, recordWaiting, type WaitingCaller } from './machine-wait.ts';
import { turnView } from './views.ts';

/**
 * A turn for an agent whose machine has every slot taken (docs/harness.md "Waiting for a free slot"): instead of going
 * to the runner and being refused (`busy`), it waits `queued` with `machine_wait = 'slots'`, delivered after, and starts
 * when a turn on that machine ends, the chat waiting longest first (`slotFree`). A turn the runner still refuses for a
 * full machine (the server counted fewer turns than it runs) waits the same way (`live.ts`). It fails `SLOT_WAIT_MS`
 * after it began waiting (the machine waits' timer, in words); the person can stop it. A task's step meanwhile stays
 * `working`. The slots are what the machine's runner says (its hello's caps), else its row's.
 */

/** What the slots need: the hub (a runner's slots now). */
export interface SlotDeps {
  readonly hub: RunnerHub;
}

/** The machine's slots now: its name, the slots its runner says (else its row's), and the turns running there. */
export async function slotsOf(deps: SlotDeps, t: TenantDb, machineId: string): Promise<MachineSlots> {
  const row = await slotsRepo.machineOf(t, machineId);
  const slots = deps.hub.connected(machineId)?.caps.slots ?? row.slots;
  return { name: row.name, slots, live: await slotsRepo.liveOn(t, machineId) };
}

/** The words of a wait for a free slot that ran out, with the chat's machine's slots now. */
export const slotWordsOf =
  (deps: SlotDeps) =>
  async (t: TenantDb, chatId: string): Promise<string> => {
    const chat = (await chatsRepo.get(t, chatId)) as Chat;
    return noSlotText(await slotsOf(deps, t, chat.machineId));
  };

/** Whether a turn of the chat may take a slot on its machine now, with the machine's slots. */
export async function slotCheck(deps: SlotDeps, t: TenantDb, chat: Pick<Chat, 'id' | 'machineId'>) {
  const slots = await slotsOf(deps, t, chat.machineId);
  return { free: slotFree(chat.id, await slotsRepo.waitersOn(t, chat.machineId), slots), slots };
}

/** What a wait for a slot needs of the turns' deps. */
export interface SlotWaitingDeps extends SlotDeps {
  readonly waits?: MachineWaits | undefined;
  readonly live: ChatsLive;
  readonly clock: () => Date;
}

/** A new turn of the chat waits for a free slot (see above): recorded `queued`, watched, told to the stream. */
export async function waitForSlot(
  deps: SlotWaitingDeps,
  t: TenantDb,
  caller: WaitingCaller,
  chat: Chat,
  prompt: string,
  slots: MachineSlots,
): Promise<{ readonly ok: true; readonly turn: ChatTurnView } | Refusal> {
  const turn = await recordWaiting(deps, t, caller, chat, { prompt, wait: 'slots' });
  deps.waits?.watch(t, chat.id, slots.name, 'slots');
  const view = turnView(turn);
  deps.live.bus.publish(chat.id, { kind: 'turn', turn: view });
  return { ok: true, turn: view };
}

/**
 * A chat's next waiting turn waits for a free slot (the queue's head while the machine is full): marked so once, its
 * wait beginning now (a turn that waited for the machine to start begins again), watched and told to the stream.
 */
export async function holdForSlot(deps: SlotWaitingDeps, t: TenantDb, head: ChatTurn, slots: MachineSlots) {
  if (head.machineWait === 'slots') return;
  const set = { machineWait: 'slots', machineWaitAt: deps.clock() } as const;
  const row = await queueRepo.updateQueued(t, head.chatId, head.id, set);
  if (row === undefined) return;
  deps.waits?.watch(t, head.chatId, slots.name, 'slots');
  deps.live.bus.publish(head.chatId, { kind: 'turn', turn: turnView(row) });
}

/** The slots' side of a runtime: a turn ended (a slot may be free), and a turn the runner refused for a full machine. */
export interface SlotWaits {
  /** A turn of the chat ended: the chats waiting for a slot on its machine start, the longest waiting first. */
  freed(t: TenantDb, chatId: string): Promise<void>;
  /** The runner refused a turn for a full machine and it now waits for a slot: its wait is watched. */
  held(t: TenantDb, turn: ChatTurn): Promise<void>;
}

export function slotWaits(
  deps: SlotDeps & {
    readonly logger: Logger;
    readonly waits: MachineWaits;
    readonly startNext: (t: TenantDb, chatId: string) => Promise<void>;
  },
): SlotWaits {
  const logged = (what: string, work: () => Promise<void>) =>
    work().catch((error: unknown) => deps.logger.error({ err: error }, `chats: could not ${what}`));
  return {
    freed: (t, chatId) =>
      logged('start the turns that waited for a slot', async () => {
        const chat = await chatsRepo.get(t, chatId);
        if (chat === undefined) return;
        const waiters = (await slotsRepo.waitersOn(t, chat.machineId)).sort(
          (a, b) => a.since.getTime() - b.since.getTime() || a.chatId.localeCompare(b.chatId),
        );
        for (const waiter of waiters) {
          const slots = await slotsOf(deps, t, chat.machineId);
          if (slots.live >= slots.slots) return;
          await deps.startNext(t, waiter.chatId);
        }
      }),
    held: (t, turn) =>
      logged('watch a turn that waits for a slot', async () => {
        const chat = (await chatsRepo.get(t, turn.chatId)) as Chat;
        deps.waits.watch(t, chat.id, (await slotsOf(deps, t, chat.machineId)).name, 'slots');
      }),
  };
}
