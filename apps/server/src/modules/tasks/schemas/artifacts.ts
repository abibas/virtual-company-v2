import { z } from '@hono/zod-openapi';
import { TaskArtifactKind } from '@mwc/shared/enums';
import { At, PrincipalRefSchema, TaskParamsSchema } from '../schemas.ts';

/** A task's artifacts (S5.3b): the path of one, its list, and how it is shown (never its bytes). */

export const ArtifactParamsSchema = TaskParamsSchema.extend({
  artifactId: z
    .string()
    .openapi({ param: { name: 'artifactId', in: 'path' }, example: '019a7b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c' }),
});

export const ArtifactSchema = z
  .object({
    id: z.string(),
    /** The step it came from, by its name when it was kept (a step removed since keeps its id and name). */
    step: z.object({ id: z.string(), name: z.string() }),
    round: z.number().int().min(1),
    name: z.string().openapi({
      example: 'notes.md',
      description:
        'Its path in the round’s folder (`shots/login.png`), or `hand-off note` for the step’s final reply',
    }),
    kind: z.enum(TaskArtifactKind.options).openapi({
      description:
        '`file` (collected from the step’s folder), `note` (the hand-off note), `link` (S6), `skipped` (seen, not ' +
        'collected: `note` says why)',
    }),
    contentType: z.string().nullable().openapi({ example: 'text/markdown; charset=utf-8' }),
    size: z.number().int().min(0),
    sha256: z.string().nullable(),
    note: z.string().nullable().openapi({ description: 'Why a file was not collected; a link’s address' }),
    /** The conversation and the turn that made it. */
    chatId: z.string().nullable(),
    turnId: z.string().nullable(),
    createdBy: PrincipalRefSchema,
    createdAt: At,
    updatedAt: At.openapi({ description: 'When it was last collected (a file collected again replaces it)' }),
  })
  .openapi('TaskArtifact');

export const ArtifactListSchema = z
  .object({ artifacts: z.array(ArtifactSchema) })
  .openapi('TaskArtifactList');

/** The bytes as they download: any of the types an artifact is kept with. */
export const ArtifactBytesSchema = z.string().openapi({ format: 'binary' });

export type ArtifactView = z.infer<typeof ArtifactSchema>;
