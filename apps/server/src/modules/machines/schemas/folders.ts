import { z } from '@hono/zod-openapi';

/**
 * The folder browser (`/api/companies/{companyId}/machines/{machineId}/folders`, docs/machines.md "The folder browser"):
 * a folder of a machine and the folders in it, as its runner read them, and a new folder.
 */

/** A path on the machine: absolute, or under the runner user's home (`~/…`). */
const FolderPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^(\/|~(\/|$))/, 'An absolute path, starting with / or ~/');

export const FoldersQuerySchema = z.object({
  path: FolderPathSchema.optional().openapi({
    param: { name: 'path', in: 'query' },
    example: '~/agents',
    description:
      'The folder to list; left out, the default start (the runner user’s home, or /work in a container)',
  }),
});

export const FolderEntrySchema = z
  .object({
    name: z.string().openapi({ example: 'slop-box' }),
    git: z.boolean().openapi({ description: 'It holds `.git` (a checkout or a worktree)' }),
    claudeMd: z.boolean().openapi({ description: 'It holds a `CLAUDE.md`' }),
  })
  .openapi('FolderEntry');

export const FolderListSchema = z
  .object({
    path: z.string().openapi({ example: '/Users/ihor/agents', description: 'The folder, resolved' }),
    parent: z
      .string()
      .nullable()
      .openapi({ description: 'The folder above; null at / and at /work in a container' }),
    entries: z.array(FolderEntrySchema).openapi({
      description: 'Its folders, sorted by name, without dot-folders; at most 500',
    }),
    truncated: z.boolean().openapi({ description: 'True when it has more than 500 folders' }),
    home: z
      .string()
      .openapi({ example: '/Users/ihor', description: "The runner user's home on the machine" }),
    root: z.string().nullable().openapi({
      example: null,
      description:
        'The only folder the runner may use: /work, its work volume, in a container; null elsewhere',
    }),
    agentsRoot: z.string().openapi({
      example: '/Users/ihor/agents',
      description: 'Where an agent’s home folder goes by default: `<home>/agents`, or /work in a container',
    }),
  })
  .openapi('FolderList');

export const MakeFolderSchema = z
  .object({
    path: FolderPathSchema.openapi({ example: '/Users/ihor/agents/scout' }),
    parents: z
      .boolean()
      .optional()
      .openapi({
        description:
          'Make its missing parents too (`mkdir -p`), only inside the runner user’s home or a container’s /work; ' +
          'a folder already there is then no error',
      }),
  })
  .openapi('MakeFolder');

export const MadeFolderSchema = z
  .object({
    path: z.string().openapi({ example: '/Users/ihor/agents/scout', description: 'The folder' }),
    created: z.boolean().openapi({ description: 'False when it was there already (with `parents`)' }),
  })
  .openapi('MadeFolder');
