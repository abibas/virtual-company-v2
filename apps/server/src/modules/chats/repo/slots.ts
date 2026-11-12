import { chats, chatTurns, machines, type TenantDb } from '@mwc/db';
import { and, count, eq, inArray, min } from 'drizzle-orm';
import type { SlotWaiter } from '../rules/machine.ts';

/**
 * A machine's slots as the chats see them (docs/harness.md "Waiting for a free slot"), through the company's tenant
 * only: its name and its recorded slots (the machines' row read only: the machines module owns it), how many turns run
 * on it, and the chats on it with turns waiting for a free slot.
 */

/** The machine's name and recorded slots (a chat's machine: always there, removed ones too). */
async function machineOf(t: TenantDb, machineId: string): Promise<{ name: string; slots: number }> {
  const [row] = await t.selectFields(
    machines,
    { name: machines.name, slots: machines.slots },
    eq(machines.id, machineId),
  );
  return row as { name: string; slots: number };
}

/** The chats on the machine, as a subquery. */
const chatsOn = (t: TenantDb, machineId: string) =>
  t.selectFields(chats, { id: chats.id }, eq(chats.machineId, machineId));

/** How many turns run on the machine (in any of its chats). */
async function liveOn(t: TenantDb, machineId: string): Promise<number> {
  const running = and(inArray(chatTurns.chatId, chatsOn(t, machineId)), eq(chatTurns.status, 'running'));
  const [row] = await t.selectFields(chatTurns, { n: count() }, running);
  return (row as { n: number }).n;
}

/** The chats on the machine with turns waiting for a free slot, each since its oldest began to wait. */
async function waitersOn(t: TenantDb, machineId: string): Promise<SlotWaiter[]> {
  const waiting = and(
    inArray(chatTurns.chatId, chatsOn(t, machineId)),
    eq(chatTurns.status, 'queued'),
    eq(chatTurns.machineWait, 'slots'),
  );
  const rows = await t
    .selectFields(chatTurns, { chatId: chatTurns.chatId, since: min(chatTurns.machineWaitAt) }, waiting)
    .groupBy(chatTurns.chatId);
  // A turn waiting for a slot always says since when (CHECK `chat_turns_machine_wait_at_check`).
  return rows.map((row) => ({ chatId: row.chatId, since: row.since as Date }));
}

export const slotsRepo = { machineOf, liveOn, waitersOn };
