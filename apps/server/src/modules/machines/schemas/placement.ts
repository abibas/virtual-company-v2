import { z } from '@hono/zod-openapi';
import { ABSOLUTE_PATH_PATTERN, MachineStatus, PLACEMENT_PATH, PlacementMode } from '@mwc/shared/machines';

/** An agent's placement (`/api/companies/{companyId}/agents/{agentId}/placement`, S4.7): where and how it runs. */

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

export const AgentPlacementParamsSchema = z.object({
  companyId: pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10'),
  agentId: pathParam('agentId', '019a4f0c-c4d5-7e6f-8a7b-9c0d1e2f3a4b'),
});

const dateTime = z.string().openapi({ format: 'date-time' });
/** A folder on the machine (`PlacementPath` of `@mwc/shared/machines`, with its example). */
const Folder = z
  .string()
  .trim()
  .min(PLACEMENT_PATH.min)
  .max(PLACEMENT_PATH.max)
  .regex(ABSOLUTE_PATH_PATTERN, 'an absolute path, starting with /')
  .openapi({ example: '/Users/ihor/agents/slop-box' });

/** An agent's default placement, with its machine's name and status. */
export const PlacementSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    machineId: z.string(),
    machineName: z.string().openapi({ example: 'This Mac' }),
    machineStatus: MachineStatus,
    /** `host`: in its home folder on the machine; `container`: a fresh locked-down container per run. */
    mode: PlacementMode,
    home: z
      .string()
      .openapi({ description: 'Its home folder there: its CLAUDE.md, skills and memory load from it' }),
    configDir: z
      .string()
      .nullable()
      .openapi({ description: '`CLAUDE_CONFIG_DIR` for its runs; null: the default' }),
    worktreeRoot: z
      .string()
      .nullable()
      .openapi({ description: 'Where its task worktrees go; null: the default' }),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .openapi('AgentPlacement');

export const PlacementResultSchema = z
  .object({ placement: PlacementSchema.nullable() })
  .openapi('AgentPlacementResult', { description: 'Its default placement; null when it has none' });

/**
 * Where an agent runs from now on: a machine of the company that is not removed, a mode and its folders. Whether its
 * turns ask before a tool is its profile's mode (since 2026-11-13); an older client's `permissionPolicy` is ignored.
 */
export const SetPlacementSchema = z
  .object({
    machineId: z.string().openapi({ example: '019a5b2e-7c4d-7e5f-8a6b-7c8d9e0f1a2b' }),
    mode: PlacementMode,
    home: Folder,
    configDir: Folder.nullable().optional(),
    worktreeRoot: Folder.nullable().optional(),
  })
  .openapi('SetAgentPlacement');

export type PlacementView = z.infer<typeof PlacementSchema>;
export type SetPlacement = z.infer<typeof SetPlacementSchema>;
