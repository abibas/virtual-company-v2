import { z } from '@hono/zod-openapi';
import { Effort, PermissionMode } from '@mwc/shared/enums';
import { ModelId } from '@mwc/shared/models';

/**
 * A chat's own mode, model and effort (2026-11-13, docs/harness.md "Modes"): what a chat shows of them, what its detail
 * shows of its profile's, what a turn shows it ran with, and the body that sets or clears them.
 */

const Mode = PermissionMode.clone().openapi('PermissionMode', {
  description:
    "A permission mode: Claude Code's `manual`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`; Codex's `ask`, " +
    '`auto`, `full`',
});
const Model = ModelId.clone().openapi({ example: 'claude-sonnet-5-5' });
const Level = Effort.clone();

/** A chat's own mode, model and effort for its next turns, each null for its profile's. */
export const ChatOverridesSchema = z
  .object({
    mode: Mode.nullable(),
    model: z.string().nullable(),
    effort: Level.nullable(),
  })
  .openapi('ChatOverrides', {
    description:
      "The chat's own mode, model and effort for its next turns (a message chat only), each null for its profile's",
  });

/** The mode, model and effort of the profile the chat runs on (its own, else its agent's). */
export const ProfileRunsSchema = z
  .object({
    mode: Mode,
    model: z.string().nullable().openapi({ description: "Null: the harness's default" }),
    effort: Level.nullable().openapi({ description: 'Null: the default' }),
  })
  .openapi('ProfileRuns');

/** The fields a turn has of what it ran with. */
export const turnRunFields = {
  mode: Mode.nullable().openapi({
    description: 'The permission mode it ran in; null before it started, for a Clear, or before 2026-11-13',
  }),
  model: z.string().nullable().openapi({ description: "The model it ran; null: the harness's default" }),
  effort: Level.nullable().openapi({ description: 'The effort it ran at; null: the default' }),
};

/** Sets (a value) or clears (null) the chat's own mode, model or effort; a field left out is kept. */
export const UpdateChatOverridesSchema = z
  .object({
    mode: Mode.nullable().optional(),
    model: Model.nullable().optional(),
    effort: Level.nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one of mode, model and effort')
  .openapi('UpdateChatOverrides');

export type UpdateChatOverrides = z.infer<typeof UpdateChatOverridesSchema>;
export type ProfileRunsView = z.infer<typeof ProfileRunsSchema>;
