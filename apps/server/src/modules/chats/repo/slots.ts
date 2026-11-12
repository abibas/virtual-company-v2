import { chats, chatTurns, machines, type TenantDb } from '@mwc/db';
import { and, count, eq, inArray, min } from 'drizzle-orm';
import type { SlotWaiter } from '../rules/machine.ts';

/**
 * A machine's slots as the chats see them (docs/harness.md "Waiting for a free slot"), through the company's tenant
 * only: its name and its recorded slots (the machines' row read only: the machines module owns it), how many turns run
 * on it, and the chats on it with turns waiting for a free slot.
 */

/** The machine's name and recorded slots; undefined for an unknown one. */
async function machineOf(
  t: TenantDb,
  machineId: string,
): Promise<{ name: string; slots: number } | undefined> {
  const [row] = await t.selectFields(
    machines,
    { name: machines.name, slots: machines.slots },
    eq(machines.id, machineId),
  );
  return row;
}

/** The ids of the chats on the machine. */
const chatsOn = async (t: TenantDb, machineId: string): Promise<string[]> =>
  (await t.selectFields(chats, { id: chats.id }, eq(chats.machineId, machineId))).map((row) => row.id);

/** How many turns run on the machine (in any of its chats). */
async function liveOn(t: TenantDb, machineId: string): Promise<number> {
  const on = await chatsOn(t, machineId);
  if (on.length === 0) return 0;
  const [row] = await t.selectFields(
    chatTurns,
    { n: count() },
    and(inArray(chatTurns.chatId, on), eq(chatTurns.status, 'running')),
  );
  return row?.n ?? 0;
}

/** The chats on the machine with turns waiting for a free slot, each since its oldest began to wait. */
async function waitersOn(t: TenantDb, machineId: string): Promise<SlotWaiter[]> {
  const on = await chatsOn(t, machineId);
  if (on.length === 0) return [];
  const rows = await t
    .selectFields(
      chatTurns,
      { chatId: chatTurns.chatId, since: min(chatTurns.machineWaitAt) },
      and(inArray(chatTurns.chatId, on), eq(chatTurns.status, 'queued'), eq(chatTurns.machineWait, 'slots')),
    )
    .groupBy(chatTurns.chatId);
  return rows.flatMap((row) => (row.since === null ? [] : [{ chatId: row.chatId, since: row.since }]));
}

export const slotsRepo = { machineOf, liveOn, waitersOn };
