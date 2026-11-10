import { z } from '@hono/zod-openapi';
import { MACHINE_POWER_ERROR_CODES } from '@mwc/machines-core';
import { PowerEventAction } from '@mwc/shared/enums';
import { DevboxSize, MachinePowerPolicy, PowerStatus, TimeZone } from '@mwc/shared/machines';

/**
 * The power API's shapes (`/api/companies/{companyId}/machines/{machineId}/power` and `/events`, S4.4b): a machine's
 * policy, the scheduler's state, its box as the controller last read it (a container runner: its container as Docker
 * reports it), its controller, and its power log.
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
  .object({
    kind: z.enum(['server', 'machine']).openapi({
      description: "`server`: this server, with its computer's airia CLI; `machine`: a machine's runner",
    }),
    /** The controlling machine; null when this server drives the box. */
    machineId: z.string().nullable(),
    name: z.string().openapi({ example: 'This server (airia CLI)' }),
    online: z.boolean(),
  })
  .openapi('MachinePowerController', {
    description: 'Who starts and stops this machine: this server itself, or a machine whose runner does',
  });

export const ContainerPowerSchema = z
  .object({
    status: z.enum(PowerStatus.options).openapi({
      description:
        "Docker's state of its container: `starting` / `stopping` while this server starts or stops it; without Docker `running` while its runner is connected, else `unknown`; `missing` when no container of it is found",
    }),
    docker: z.boolean().openapi({
      description:
        'True when this server starts and stops it itself (MWC_LOCAL_DOCKER); else `commands` are run by hand',
    }),
    commands: z
      .object({
        start: z.string().openapi({
          example:
            'docker compose -p mwc-runner-docker-runner -f /srv/v2/deploy/compose.yml --profile runner start runner-local',
        }),
        stop: z.string(),
        create: z.string().openapi({
          description:
            'Creates its container again in its compose project (its volumes keep its enrollment), at the default limits',
        }),
      })
      .openapi({
        description: 'What a person runs on the computer running Docker to start, stop or create it',
      }),
    error: z.string().nullable().openapi({ description: 'Why Docker could not tell its state just now' }),
  })
  .openapi('MachineContainerPower', { description: "A container runner's container, as Docker reports it" });

/** What `GET .../power` and every power change answer. */
export const MachinePowerSchema = z
  .object({
    policy: MachinePowerPolicy,
    state: PowerStateSchema,
    /** Devboxes only. */
    box: BoxSchema.nullable(),
    /** Container runners only. */
    container: ContainerPowerSchema.nullable(),
    controller: PowerControllerSchema.nullable(),
    /** True for admins and owners: they may change the policy and start or stop the box or the container. */
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

/** `POST …/power/start` and `…/power/stop`'s optional body. */
export const PowerActionBodySchema = z
  .object({
    force: z.boolean().optional().openapi({
      description:
        "A container's Stop even while chat turns or terminals run on the machine (they are cut off); never while another job runs",
    }),
  })
  .openapi('MachinePowerRequest');

/** A 409: the common error body, and for `power_unsupported` and `container_missing` the command to run instead. */
export const PowerRefusalSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'power_unsupported' }),
      message: z.string(),
      requestId: z.string(),
      command: z.string().optional().openapi({
        description:
          "For a container's `power_unsupported` and `container_missing`: the command to run by hand",
      }),
    }),
  })
  .openapi('MachinePowerRefusal');

export type MachinePowerView = z.infer<typeof MachinePowerSchema>;
export type ContainerPowerView = z.infer<typeof ContainerPowerSchema>;
export type PowerControllerView = z.infer<typeof PowerControllerSchema>;
export type PowerEventView = z.infer<typeof PowerEventSchema>;
