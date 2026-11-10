import { z } from '@hono/zod-openapi';
import { InstallableTool } from '@mwc/shared/machines';

/**
 * A machine's tools (`/api/companies/{companyId}/machines/{machineId}/tools/…`, docs/machines.md "Tools"): the CLIs its
 * runner found, the versions this server installs, a check, and an install with its output.
 */

const dateTime = z.string().openapi({ format: 'date-time' });

/** What a CLI's `--version` printed first, or null when the runner did not find it. */
const printed = (example: string | null) => z.string().nullable().openapi({ example });

export const MachineToolsSchema = z
  .object({
    claude: printed('2.1.319 (Claude Code)'),
    codex: printed('codex-cli 0.163.0'),
    git: printed('git version 2.39.5'),
    gh: printed(null),
    docker: printed(null),
  })
  .openapi('MachineTools');

export const ToolsLatestSchema = z
  .object({
    claude: z.string().openapi({ example: '2.1.308' }),
    codex: z.string().openapi({ example: '0.163.0' }),
  })
  .openapi('MachineToolsLatest', {
    description:
      'The version of Claude Code and Codex this server installs (the Dockerfiles’ pins): an older one is due an update, a newer one is fine',
  });

export const ToolsCheckedSchema = z.object({ tools: MachineToolsSchema }).openapi('MachineToolsChecked');

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

export const ToolInstallParamsSchema = z.object({
  companyId: pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10'),
  machineId: pathParam('machineId', '019a5b2e-7c4d-7e5f-8a6b-7c8d9e0f1a2b'),
  installId: pathParam('installId', '019a6c3f-8d5e-7f60-9b7c-8d9e0f1a2b3c'),
});

const Tool = z
  .enum(InstallableTool.options)
  .openapi({ description: '`claude` (Claude Code) or `codex` (Codex)' });

export const ToolInstallBodySchema = z.object({ tool: Tool }).openapi('ToolInstallRequest');

export const ToolInstallStartedSchema = z
  .object({
    installId: z.string(),
    tool: Tool,
    version: z
      .string()
      .openapi({ example: '0.163.0', description: 'The version it installs: this server’s pin' }),
  })
  .openapi('ToolInstallStarted');

export const ToolInstallQuerySchema = z.object({
  from: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({
      param: { name: 'from', in: 'query' },
      description: 'The first output line to return (0 by default)',
    }),
});

export const ToolInstallStatus = z.enum(['running', 'succeeded', 'failed']);
export type ToolInstallStatus = z.infer<typeof ToolInstallStatus>;

export const ToolInstallSchema = z
  .object({
    id: z.string(),
    tool: Tool,
    version: z.string().openapi({ example: '0.163.0' }),
    status: ToolInstallStatus,
    lines: z
      .array(z.string())
      .openapi({ description: 'What npm printed, from `from` on (at most 500 lines in all)' }),
    next: z.number().int().openapi({ description: 'How many lines there are so far: the next `from`' }),
    tools: MachineToolsSchema.nullable().openapi({
      description:
        'The CLIs the runner found once it ended; null while it runs or when the runner did not say',
    }),
    error: z.string().nullable().openapi({
      description:
        'Why it failed, `<code>: <words>` (`busy`, `unsupported`, `npm_missing`, `timeout`, `failed`, `machine_offline`, `runner_outdated`)',
    }),
    startedAt: dateTime,
    finishedAt: dateTime.nullable(),
  })
  .openapi('ToolInstall');

export type ToolInstallView = z.infer<typeof ToolInstallSchema>;
