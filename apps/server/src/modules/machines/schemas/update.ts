import { z } from '@hono/zod-openapi';

/**
 * Updating a machine's runner (`POST /api/companies/{companyId}/machines/{machineId}/runner-update`, docs/machines.md
 * "Updating a runner"): what the server did, and the refusal that names the command to run instead.
 */

/** How the runner was updated: by itself over its link, or reinstalled by this server over SSH. */
export const RunnerUpdatePath = z.enum(['self_update', 'ssh_reinstall']);
export type RunnerUpdatePath = z.infer<typeof RunnerUpdatePath>;

export const RunnerUpdateSchema = z
  .object({
    path: RunnerUpdatePath.openapi({
      description:
        '`self_update`: the runner put the new build in place and restarts; `ssh_reinstall`: this server ran its install again on the box',
    }),
    build: z.string().nullable().openapi({
      description: 'The build the runner restarts on (`self_update`); null when the reinstall does not say',
    }),
  })
  .openapi('RunnerUpdate');
export type RunnerUpdateView = z.infer<typeof RunnerUpdateSchema>;

/** A 409: the common error body, and for `update_unsupported` the command to run on the machine instead. */
export const RunnerUpdateRefusalSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'update_unsupported' }),
      message: z.string(),
      requestId: z.string(),
      command: z.string().optional().openapi({
        description:
          'For `update_unsupported`: the command that updates this runner by hand (no token in it)',
      }),
    }),
  })
  .openapi('RunnerUpdateRefusal');
