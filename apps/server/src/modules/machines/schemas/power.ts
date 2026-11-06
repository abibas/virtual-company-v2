import { z } from '@hono/zod-openapi';
import { MACHINE_POWER_ERROR_CODES } from '@mwc/machines-core';
import { PowerEventAction } from '@mwc/shared/enums';
import { DevboxSize, MachinePowerPolicy, PowerStatus, TimeZone } from '@mwc/shared/machines';

/**
 * The power API's shapes (`/api/companies/{companyId}/machines/{machineId}/power` and `/events`, S4.4b): a machine's
 * policy, the scheduler's state, its box as the controller last read it, its controller, and its power log.
 */

const dateTime = z.string().openapi({ format: 'date-time' });

/** The devbox's own stop rules (its instance metadata), read-only here except the time zone. */
export const BoxRulesSchema = z
  .object({
    timezone: z.string().openapi({ example: 'Europe/Kyiv' }),
    idleShutdownMin: z.number(),
    idleOffhoursMin: z.number(),
    idleLoadThreshold: z.number(),
    workStartHour: z.number().int(),
    workEndHour: z.number().int(),
    nightlyStopHour: z.number().int(),
  })
  .openapi('DevboxRules', { description: "The box's own idle and nightly stop rules, from its metadata" });

export const PowerErrorCode = z.enum(MACHINE_POWER_ERROR_CODES);

export const PowerErrorSchema = z
  .object({ code: PowerErrorCode, message: z.string() })
  .openapi('MachinePowerError', { description: 'Why the last reading or command failed' });

export const BoxSchema = z
  .object({
    status: PowerStatus,
    size: DevboxSize.nullable(),
    hourlyCost: z.number().nullable().openapi({ example: 0.268 }),
    rules: BoxRulesSchema.nullable(),
    checkedAt: dateTime.nullable(),
    error: PowerErrorSchema.nullable(),
  })
  .openapi('MachineBox', {
    description:
      'The box as its controller last read it (at most every 5 minutes, and after each start or stop)',
  });

export const PowerStateSchema = z
  .object({
    holdUntil: dateTime.nullable(),
    holdReason: z.string().nullable(),
    autoStartedWindow: z.string().nullable().openapi({ example: '2026-11-06' }),
    manualStopAt: dateTime.nullable(),
    lastTurnAt: dateTime.nullable(),
  })
  .openapi('MachinePowerState');

export const PowerControllerSchema = z
  .object({ machineId: z.string(), name: z.string(), online: z.boolean() })
  .openapi('MachinePowerController', { description: 'The machine whose runner starts and stops this one' });

/** What `GET .../power` and every power change answer. */
export const MachinePowerSchema = z
  .object({
    policy: MachinePowerPolicy,
    state: PowerStateSchema,
    /** Devboxes only. */
    box: BoxSchema.nullable(),
    controller: PowerControllerSchema.nullable(),
    /** True for admins and owners: they may change the policy and start or stop the box. */
    canControl: z.boolean(),
  })
  .openapi('MachinePower');

export const PowerTimezoneSchema = z.object({ timezone: TimeZone }).openapi('MachinePowerTimezone');

export const PowerEventsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .openapi({ param: { name: 'limit', in: 'query' }, example: 10 }),
});

export const PowerEventSchema = z
  .object({
    id: z.string(),
    action: PowerEventAction,
    reason: z.string(),
    actor: z.string().openapi({ example: 'schedule' }),
    /** The person's name for `user:<id>`; null for the scheduler and the system. */
    actorName: z.string().nullable(),
    at: dateTime,
  })
  .openapi('MachinePowerEvent');

export const PowerEventsSchema = z
  .object({ events: z.array(PowerEventSchema) })
  .openapi('MachinePowerEvents');

/** A 502 `power_failed`: the common error body with the driver's own code. */
export const PowerFailedSchema = z
  .object({
    error: z.object({
      code: z.literal('power_failed'),
      message: z.string(),
      requestId: z.string(),
      driverCode: PowerErrorCode,
    }),
  })
  .openapi('MachinePowerFailed');

export type MachinePowerView = z.infer<typeof MachinePowerSchema>;
export type PowerEventView = z.infer<typeof PowerEventSchema>;
