import { z } from '@hono/zod-openapi';
import { LeadWakeOutcome } from '@mwc/shared/enums';
import { LEAD_WAKE } from '@mwc/shared/flows';
import { At } from '../schemas.ts';

// A flow's Lead wake-ups (S6c, docs/processes.md "Built: the Lead wakes up"): its settings, and how its wake-ups went.

const bounded = (range: { readonly min: number; readonly max: number }) =>
  z.number().int().min(range.min).max(range.max);

/** Which events wake the flow's Lead agent, the quiet window that coalesces them, the caps, and its check-ins. */
export const LeadWakeSettingsSchema = z
  .object({
    escalated: z.boolean(),
    blocked: z.boolean(),
    turnEnded: z.boolean(),
    done: z.boolean(),
    /** Wake it when a task has waited this many hours for a person's sign-off; null: never. */
    signoffHours: bounded(LEAD_WAKE.signoffHours).nullable(),
    /** Events within this many seconds of the first go as one wake-up. */
    windowSeconds: bounded(LEAD_WAKE.windowSeconds),
    /** At most this many wake-ups an hour, and a day; past either, the Lead's nearest person is told instead. */
    maxPerHour: bounded(LEAD_WAKE.perHour),
    maxPerDay: bounded(LEAD_WAKE.perDay),
    /** Check in with the Lead every this many minutes while the flow has work; null: never. */
    checkInMinutes: bounded(LEAD_WAKE.checkInMinutes).nullable(),
  })
  .openapi('LeadWakeSettings');

export const LeadWakesSchema = LeadWakeSettingsSchema.extend({
  /** The flow's Lead is an agent on the chart: only an agent wakes up (a person Lead hears through notifications). */
  leadIsAgent: z.boolean(),
  /** The team chat the Lead was last woken in, with its agent (the chat page's address); null before any wake-up. */
  chat: z.object({ id: z.string(), agentId: z.string() }).nullable(),
  /** The last wake-up that was told or held, and why it was held. */
  last: z
    .object({
      outcome: z.enum(LeadWakeOutcome.options.filter((o) => o !== 'pending' && o !== 'dropped')),
      at: At,
      detail: z.string().nullable(),
    })
    .nullable(),
  /** Wake-ups in the last hour and day, and the events waiting for their window. */
  counts: z.object({ hour: z.number().int(), day: z.number().int(), pending: z.number().int() }),
}).openapi('LeadWakes');

export type LeadWakeSettingsBody = z.infer<typeof LeadWakeSettingsSchema>;
export type LeadWakesView = z.infer<typeof LeadWakesSchema>;
