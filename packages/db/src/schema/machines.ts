import { HoldSource, MachineKind, MachineProvider, MachineStatus, PowerEventAction } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { MACHINE_NAME } from '@mwc/shared/machines';
import { RUNNER_SLOTS_MAX } from '@mwc/shared/runner-protocol';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, oneOf, updatedAt } from './columns.ts';
import { principals } from './principals.ts';
import { companyIdColumn, tenantForeignKey, tenantKey } from './tenant.ts';

/**
 * Machines (S4, docs/machines.md): where agents run, each with one runner that dials the server. A machine is made by
 * enrolling it with a one-time token; its runner key is an `api_keys` row (`kind = runner`, `machine_id`). Every
 * runner connection is a session (the up/down history), and every minute's sample is a row kept 7 days. The power
 * policy and its log (`machine_power`, `machine_power_events`) are used from S4.4b.
 */

/** A number written into a CHECK as it is (the limits come from `@mwc/shared`, which the API reads too). */
const n = (value: number) => sql.raw(String(value));
const at = (name: string) => timestamp(name, { withTimezone: true });

export const machines = pgTable(
  'machines',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    /** What people call it ("This Mac"), 1–80 characters. */
    name: text('name').notNull(),
    kind: text('kind').$type<MachineKind>().notNull(),
    provider: text('provider').$type<MachineProvider>().notNull().default('none'),
    /** Where the provider finds it (the devbox: `AiriaDevboxRef`); null for `none`. */
    providerRef: jsonb('provider_ref').$type<Record<string, unknown>>(),
    /** The machine whose runner powers this one on and off (This Mac for the devbox); none by default. */
    controllerMachineId: uuid('controller_machine_id'),
    os: text('os').notNull(),
    arch: text('arch').notNull(),
    hostname: text('hostname').notNull(),
    unixUser: text('unix_user').notNull(),
    runnerVersion: text('runner_version').notNull(),
    claudeVersion: text('claude_version'),
    /** How many runs it takes at once (`runner.hello.caps.slots`). */
    slots: integer('slots').notNull().default(1),
    status: text('status').$type<MachineStatus>().notNull().default('offline'),
    lastSeenAt: at('last_seen_at'),
    /** What an hour of it costs in dollars (the devbox by its size); null when nothing is known. */
    hourlyCost: numeric('hourly_cost', { precision: 10, scale: 4, mode: 'number' }),
    /** The hold its runner reports (`hold.state`): until when it keeps the machine awake, and what set it. */
    holdUntil: at('hold_until'),
    holdSource: text('hold_source').$type<HoldSource>(),
    /** Removed by an admin: its runner key is revoked and it is shown nowhere; its history stays. */
    removedAt: at('removed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantKey('machines', t),
    tenantForeignKey('machines_controller_fk', t.companyId, t.controllerMachineId, t),
    check(
      'machines_name_check',
      sql`char_length(${t.name}) between ${n(MACHINE_NAME.min)} and ${n(MACHINE_NAME.max)}`,
    ),
    check('machines_kind_check', oneOf(t.kind, MachineKind.options)),
    check('machines_provider_check', oneOf(t.provider, MachineProvider.options)),
    check('machines_status_check', oneOf(t.status, MachineStatus.options)),
    check('machines_hold_source_check', oneOf(t.holdSource, HoldSource.options)),
    check('machines_provider_ref_check', sql`jsonb_typeof(${t.providerRef}) = 'object'`),
    check('machines_slots_check', sql`${t.slots} between 0 and ${n(RUNNER_SLOTS_MAX)}`),
    check('machines_hourly_cost_check', sql`${t.hourlyCost} >= 0`),
    check('machines_controller_check', sql`${t.controllerMachineId} <> ${t.id}`),
    index('machines_status_idx').on(t.status, t.lastSeenAt),
  ],
);

/** One-time tokens an admin makes to enroll a machine: only their SHA-256 is stored; used once, within an hour. */
export const enrollmentTokens = pgTable(
  'enrollment_tokens',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    secretHash: text('secret_hash').notNull().unique(),
    expiresAt: at('expires_at').notNull(),
    usedAt: at('used_at'),
    /** The person who made it; the machine's runner key is theirs. */
    createdBy: uuid('created_by').notNull(),
    /** The machine it enrolled, once used. */
    machineId: uuid('machine_id'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('enrollment_tokens', t),
    tenantForeignKey('enrollment_tokens_created_by_fk', t.companyId, t.createdBy, principals),
    tenantForeignKey('enrollment_tokens_machine_fk', t.companyId, t.machineId, machines),
    check('enrollment_tokens_secret_hash_check', sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check('enrollment_tokens_machine_check', sql`${t.machineId} is null or ${t.usedAt} is not null`),
  ],
);

/** Every connection of a machine's runner, from its hello to its close: the source of up/down and runtime. */
export const runnerSessions = pgTable(
  'runner_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    machineId: uuid('machine_id').notNull(),
    connectedAt: at('connected_at').notNull().defaultNow(),
    disconnectedAt: at('disconnected_at'),
    /** The runner's version on this connection. */
    version: text('version').notNull(),
    remoteIp: text('remote_ip'),
  },
  (t) => [
    tenantKey('runner_sessions', t),
    tenantForeignKey('runner_sessions_machine_fk', t.companyId, t.machineId, machines),
    check('runner_sessions_span_check', sql`${t.disconnectedAt} >= ${t.connectedAt}`),
    index('runner_sessions_machine_idx').on(t.companyId, t.machineId, t.connectedAt),
  ],
);

/** A machine's sample of each minute (`MachineSample`, `at` truncated to the minute), kept 7 days. */
export const machineSamples = pgTable(
  'machine_samples',
  {
    companyId: companyIdColumn(),
    machineId: uuid('machine_id').notNull(),
    at: at('at').notNull(),
    load1: doublePrecision('load1').notNull(),
    load5: doublePrecision('load5').notNull(),
    load15: doublePrecision('load15').notNull(),
    cpus: integer('cpus').notNull(),
    cpuPct: doublePrecision('cpu_pct').notNull(),
    memPct: doublePrecision('mem_pct').notNull(),
    diskUsed: bigint('disk_used', { mode: 'number' }).notNull(),
    diskTotal: bigint('disk_total', { mode: 'number' }).notNull(),
    uptimeS: bigint('uptime_s', { mode: 'number' }).notNull(),
    liveRuns: integer('live_runs').notNull(),
  },
  (t) => [
    primaryKey({ name: 'machine_samples_pkey', columns: [t.companyId, t.machineId, t.at] }),
    tenantForeignKey('machine_samples_machine_fk', t.companyId, t.machineId, machines),
    check('machine_samples_cpus_check', sql`${t.cpus} >= 1`),
    index('machine_samples_at_idx').on(t.at),
  ],
);

/** A machine's power policy (`MachinePowerPolicy`) and the scheduler's state: one row per machine (S4.4b). */
export const machinePower = pgTable(
  'machine_power',
  {
    companyId: companyIdColumn(),
    machineId: uuid('machine_id').notNull(),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull().default({}),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    /** Who last changed the policy; null for the system. */
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'machine_power_pkey', columns: [t.companyId, t.machineId] }),
    tenantForeignKey('machine_power_machine_fk', t.companyId, t.machineId, machines),
    tenantForeignKey('machine_power_updated_by_fk', t.companyId, t.updatedBy, principals),
    check('machine_power_policy_check', sql`jsonb_typeof(${t.policy}) = 'object'`),
    check('machine_power_state_check', sql`jsonb_typeof(${t.state}) = 'object'`),
  ],
);

/** Every power decision and its outcome, with why and who: the machine's log (S4.4b). */
export const machinePowerEvents = pgTable(
  'machine_power_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    companyId: companyIdColumn(),
    machineId: uuid('machine_id').notNull(),
    action: text('action').$type<PowerEventAction>().notNull(),
    reason: text('reason').notNull(),
    /** `user:<user id>`, `schedule`, `auto` or `system`. */
    actor: text('actor').notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    tenantKey('machine_power_events', t),
    tenantForeignKey('machine_power_events_machine_fk', t.companyId, t.machineId, machines),
    check('machine_power_events_action_check', oneOf(t.action, PowerEventAction.options)),
    check('machine_power_events_reason_check', sql`char_length(${t.reason}) between 1 and 500`),
    check(
      'machine_power_events_actor_check',
      sql`${t.actor} ~ '^(user:[0-9a-f-]{36}|schedule|auto|system)$'`,
    ),
    index('machine_power_events_machine_idx').on(t.companyId, t.machineId, t.at),
  ],
);

export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type EnrollmentTokenRow = typeof enrollmentTokens.$inferSelect;
export type NewEnrollmentToken = typeof enrollmentTokens.$inferInsert;
export type RunnerSession = typeof runnerSessions.$inferSelect;
export type MachineSampleRow = typeof machineSamples.$inferSelect;
export type NewMachineSample = typeof machineSamples.$inferInsert;
export type MachinePowerRow = typeof machinePower.$inferSelect;
export type MachinePowerEvent = typeof machinePowerEvents.$inferSelect;
