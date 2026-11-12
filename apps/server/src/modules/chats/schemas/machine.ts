import { z } from '@hono/zod-openapi';

/** A prompt's refusals for a stopped machine (docs/harness.md, "When the machine is stopped"). */

/** A 409 `machine_stopped`: the machine, for "Start <machine> · $0.54/h and send". */
export const MachineStoppedSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'machine_stopped' }),
      message: z.string(),
      requestId: z.string(),
      machine: z
        .object({
          id: z.string(),
          name: z.string(),
          hourlyCost: z.number().nullable(),
          canStart: z.boolean().openapi({ description: 'The caller may start it (an admin or owner)' }),
        })
        .optional()
        .openapi({ description: 'For `machine_stopped`: the stopped machine' }),
    }),
  })
  .openapi('ChatTurnRefusal');
