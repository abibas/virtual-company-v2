import { z } from '@hono/zod-openapi';
import { InstallableTool } from '@mwc/shared/machines';
import { RunnerUpdatePath } from './update.ts';

/**
 * A machine's maintenance job and its live work as `GET machines` shows them (docs/machines.md, "One job at a time"):
 * the install or runner update holding the machine's lock, and how many chat turns and terminals run on it now.
 */

export const MachineJobSchema = z
  .object({
    kind: z.enum(['tool_install', 'runner_update']).openapi({
      description:
        '`tool_install`: Claude Code or Codex is being installed; `runner_update`: the runner is updating',
    }),
    tool: z.enum(InstallableTool.options).optional().openapi({ description: 'The CLI being installed' }),
    version: z
      .string()
      .optional()
      .openapi({ example: '0.167.0', description: 'The version being installed' }),
    path: RunnerUpdatePath.optional().openapi({ description: 'How the runner is being updated' }),
    progress: z.string().optional().openapi({
      example: '#12 [bundle 3/3] RUN pnpm install --frozen-lockfile',
      description: "A container's rebuild: the last line of its output so far",
    }),
    startedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('MachineJob', {
    description:
      "The maintenance job holding the machine's lock: another install or a runner update waits for it",
  });
export type MachineJobView = z.infer<typeof MachineJobSchema>;

export const RunnerUpdateFailureSchema = z
  .object({
    path: RunnerUpdatePath,
    message: z.string().openapi({
      example:
        'The container was not rebuilt: failed to solve: process "/bin/sh -c pnpm install" did not complete',
    }),
    command: z.string().nullable().openapi({
      description: 'The command that updates the runner by hand, to see the whole output (no token in it)',
    }),
    at: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('RunnerUpdateFailure', {
    description:
      "A runner update that failed after the answer (a container's rebuild), kept until the next job on the machine or 30 minutes",
  });
export type RunnerUpdateFailureView = z.infer<typeof RunnerUpdateFailureSchema>;

export const MachineLiveSchema = z
  .object({
    turns: z.number().int().openapi({ description: 'Chat turns running on it now' }),
    terminals: z
      .number()
      .int()
      .openapi({ description: "Terminals open on it now (the machine's and the chats')" }),
  })
  .openapi('MachineLive', { description: 'Its live work: a runner update waits for it to end' });
export type MachineLiveView = z.infer<typeof MachineLiveSchema>;

/** `POST …/runner-update`'s optional body. */
export const RunnerUpdateBodySchema = z
  .object({
    force: z.boolean().optional().openapi({
      description:
        'Update even while chat turns or terminals run on the machine (they are cut off); never while another job runs',
    }),
  })
  .openapi('RunnerUpdateRequest');
