import { z } from '@hono/zod-openapi';
import { HoldSource, MachineKind, MachineProvider, MachineStatus } from '@mwc/shared/enums';
import { LogoRef } from '@mwc/shared/logos';
import { MACHINE_NAME } from '@mwc/shared/machines';
import { TunnelStatus } from '@mwc/shared/runner-protocol';

/** The machines API's shapes (`/api/companies/{companyId}/machines`): never a runner key's secret or hash. */

const companyId = z
  .string()
  .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' });

export const MachinesParamsSchema = z.object({ companyId });

export const MachineParamsSchema = z.object({
  companyId,
  machineId: z
    .string()
    .openapi({ param: { name: 'machineId', in: 'path' }, example: '019a5b2e-7c4d-7e5f-8a6b-7c8d9e0f1a2b' }),
});

const dateTime = z.string().openapi({ format: 'date-time' });

/** The machine's logo version (for `GET .../logo?v=<version>`), or null when it has none. */
export const MachineLogoRefSchema = LogoRef.nullable().openapi({ example: { version: '9f86d081884c7d65' } });

/** A devbox's link to this server: its controller's SSH tunnel, as the controller last reported it (memory only). */
export const TunnelSchema = z
  .object({
    state: z
      .enum(TunnelStatus.options)
      .openapi({ description: '`connecting`, `up` (alive 10 s), or `down` (retried later)' }),
    error: z.string().nullable().openapi({ description: 'The last line the tunnel printed when it ended' }),
    since: dateTime.openapi({ description: 'When it entered this state' }),
  })
  .openapi('MachineTunnel');

/** A machine's runner: the build it runs, whether that is the one this server hands out, and what it can do. */
export const MachineRunnerSchema = z
  .object({
    build: z.string().nullable().openapi({
      description:
        'The SHA-256 of the bundle it runs; null when it is offline, runs from its sources or did not say',
    }),
    current: z.boolean().nullable().openapi({
      description:
        'True when it runs the bundle this server hands out, false when another; null when either is unknown',
    }),
    terminal: z.boolean().openapi({ description: 'It opens terminals; false while offline' }),
    selfUpdate: z.boolean().openapi({ description: 'It updates itself over its link; false while offline' }),
  })
  .openapi('MachineRunner');

/** A machine as the API shows it. */
export const MachineSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'This Mac' }),
    kind: MachineKind,
    provider: MachineProvider,
    /** Where its provider finds it (the devbox: instance, zone, size); null for `none`. */
    providerRef: z.record(z.string(), z.unknown()).nullable(),
    /** The machine whose runner powers this one on and off; null when none does. */
    controllerMachineId: z.string().nullable(),
    os: z.string().openapi({ example: 'darwin' }),
    arch: z.string().openapi({ example: 'arm64' }),
    hostname: z.string(),
    unixUser: z.string(),
    versions: z.object({
      runner: z.string().openapi({ example: '0.5.0' }),
      claude: z.string().nullable().openapi({ example: '2.1.3 (Claude Code)' }),
    }),
    slots: z.number().int(),
    status: MachineStatus,
    lastSeenAt: dateTime.nullable(),
    /** The hold its runner reports: until when it keeps the machine awake, and what set it. */
    hold: z.object({ until: dateTime.nullable(), source: HoldSource.nullable() }),
    /** What an hour of it costs, in dollars; null when nothing is known. */
    hourlyCost: z.number().nullable(),
    /** How many agents (not archived) have their default placement on it. */
    agentCount: z.number().int(),
    /** A devbox's tunnel as its controller reported it; null for other machines and before a report. */
    tunnel: TunnelSchema.nullable(),
    /** Its runner as this server sees it now (memory: what its connected runner said in its hello). */
    runner: MachineRunnerSchema,
    logo: MachineLogoRefSchema,
    createdAt: dateTime,
  })
  .openapi('Machine');

export const MachineListSchema = z.object({ machines: z.array(MachineSchema) }).openapi('MachineList');

/** A machine's change: its name, and for a devbox the machine whose runner powers it (null clears it). */
export const UpdateMachineSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(MACHINE_NAME.min, 'A name is required')
      .max(MACHINE_NAME.max, `A name is at most ${MACHINE_NAME.max} characters`)
      .optional()
      .openapi({ example: 'Airia devbox' }),
    controllerMachineId: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: 'A machine of this company whose runner powers this devbox; null clears it' }),
  })
  .refine((body) => body.name !== undefined || body.controllerMachineId !== undefined, {
    message: 'Nothing to change: give a name or a controllerMachineId',
  })
  .openapi('UpdateMachine');

export type MachineUpdate = z.infer<typeof UpdateMachineSchema>;

/** A new enrollment token: the token itself is in this response only. */
export const EnrollmentTokenSchema = z
  .object({
    id: z.string(),
    token: z.string().openapi({
      example: 'mwc_et_AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      description: 'Shown in this response only; good for one enrollment within the hour',
    }),
    expiresAt: dateTime,
  })
  .openapi('EnrollmentToken');

export type MachineView = z.infer<typeof MachineSchema>;
export type TunnelView = z.infer<typeof TunnelSchema>;
export type EnrollmentTokenView = z.infer<typeof EnrollmentTokenSchema>;
