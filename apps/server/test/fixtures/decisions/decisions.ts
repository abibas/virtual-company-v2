/**
 * The decision log's tests helpers (2026-11-14): one world whose app keeps the Lead wake-ups' tick and Slack's fake
 * Socket Mode (so a team room's turns and a Slack conversation's turns run in it too), the decisions and their audit
 * rows as stored, and the list's path. Never a real CLI: the runner is the fake.
 */
import { auditLog, type DbHandle, decisions } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq } from 'drizzle-orm';
import { chatsWorld } from '../chats/world.ts';
import { FakeSockets, type InboundWorld } from '../integrations/slack-inbound.ts';
import type { MembersCompany } from '../members/members.ts';
import { manualTimers } from '../platform/jobs.ts';
import type { WakeWorld } from '../wakes.ts';

/** A world for every kind of turn: the wake-ups' world and the Slack inbound world at once. */
export type DecisionsWorld = WakeWorld & InboundWorld;

export async function decisionsWorld(): Promise<DecisionsWorld> {
  const ticks = manualTimers();
  const timers = manualTimers();
  const sockets = new FakeSockets();
  const w = await chatsWorld(
    {},
    { leadWakeTimers: ticks.timers, slackSockets: sockets, slackInboundTimers: timers.timers },
  );
  return { ...w, ticks, timers, sockets };
}

/** The decisions recorded in a chat, oldest first. */
export const decisionRows = (db: DbHandle, chatId: string) =>
  rawDb(db).select().from(decisions).where(eq(decisions.chatId, chatId)).orderBy(asc(decisions.createdAt));

/** A decision's audit rows, by field. */
export const decisionAudit = (db: DbHandle, decisionId: string) =>
  rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'decision'), eq(auditLog.entityId, decisionId)))
    .orderBy(asc(auditLog.field));

/** The company's decisions' path, with a query when given. */
export const decisionsPath = (company: Pick<MembersCompany, 'companyId'>, query = '') =>
  `/api/companies/${company.companyId}/decisions${query}`;
