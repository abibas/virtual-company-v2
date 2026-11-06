import { z } from '@hono/zod-openapi';
import { MachineKind, MachineProvider, MachineStatus } from '@mwc/shared/enums';

/** The home board's machine stats (`GET /api/companies/{companyId}/machines/stats`), from `rules/stats.ts`. */

const dateTime = z.string().openapi({ format: 'date-time' });

const SegmentSchema = z
  .object({ from: dateTime, to: dateTime, up: z.boolean() })
  .openapi('MachineUpDownSegment', { description: 'A stretch when its runner was connected (`up`) or not' });

const NowSchema = z
  .object({
    at: dateTime,
    load1: z.number(),
    cpus: z.number().int(),
    loadPerCpu: z.number(),
    cpuPct: z.number(),
    memPct: z.number(),
    diskUsed: z.number().int(),
    diskTotal: z.number().int(),
  })
  .openapi('MachineNow', { description: 'The latest sample, when it is under 3 minutes old' });

export const MachineStatsSchema = z
  .object({
    machineId: z.string(),
    name: z.string(),
    kind: MachineKind,
    provider: MachineProvider,
    status: MachineStatus,
    lastSeenAt: dateTime.nullable(),
    agentCount: z
      .number()
      .int()
      .openapi({ description: 'Agents (not archived) whose default placement is on it' }),
    now: NowSchema.nullable(),
    /** When the current online stretch began; null when offline. */
    upSince: dateTime.nullable(),
    runtime: z.object({ h24Ms: z.number().int(), d7Ms: z.number().int() }).openapi({
      description: 'How long its runner was connected in the last 24 hours and 7 days',
    }),
    agentRuns24hMs: z.number().int().nullable().openapi({ description: 'Null until runs exist (S5)' }),
    series: z
      .array(z.object({ at: dateTime, loadPerCpu: z.number().nullable() }))
      .openapi({ description: '288 five-minute means of load1 per CPU over 24 hours, oldest first' }),
    upDown: z.object({ h24: z.array(SegmentSchema), d7: z.array(SegmentSchema) }),
    overloaded: z.object({ now: z.boolean(), share24h: z.number(), badge: z.boolean() }).openapi({
      description: 'Load per CPU above 1.0 or CPU above 85%; the badge: now, or over half of 24 hours',
    }),
  })
  .openapi('MachineStats');

export const MachineStatsListSchema = z
  .object({ at: dateTime, machines: z.array(MachineStatsSchema) })
  .openapi('MachineStatsList');

export type MachineStatsView = z.infer<typeof MachineStatsSchema>;
export type MachineStatsListView = z.infer<typeof MachineStatsListSchema>;
