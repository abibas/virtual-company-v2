import { z } from '@hono/zod-openapi';
import { ACCESS_PROFILE_NAME, AtlassianRights, GitHubRights, SlackRights } from '@mwc/shared/credentials';
import { ClaudeMode, CodexMode, CredentialKind, CredentialStatus, Effort } from '@mwc/shared/enums';
import { MODEL_ID_MAX, MODEL_ID_PATTERN } from '@mwc/shared/models';

/**
 * The profiles API's shapes (`/api/me/access-profiles`, S3.4; generic since 2026-11-13, docs/subscriptions.md
 * "Profiles"): a person's named profile with optional parts, each added, changed or removed on its own: a Claude and an
 * OpenAI part (one of the person's subscriptions of that provider, any of their gateways, the model and effort its turns
 * run and the permission mode they run in) and a GitHub and an Atlassian part (one of their sign-ins of that tool and its rights). A credential shows its
 * metadata, never a secret.
 */

export const AccessProfileParamsSchema = z.object({
  profileId: z.string().openapi({
    param: { name: 'profileId', in: 'path' },
    example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f',
  }),
});

const name = z
  .string()
  .trim()
  .min(ACCESS_PROFILE_NAME.min, 'A name is required')
  .max(ACCESS_PROFILE_NAME.max, `A name is at most ${ACCESS_PROFILE_NAME.max} characters`)
  .openapi({ example: 'Work' });

/** A model id (one of the catalogue's of the part's provider, or another), or null for its default. */
const model = z
  .string()
  .trim()
  .min(1, 'A model id is required')
  .max(MODEL_ID_MAX, `A model id is at most ${MODEL_ID_MAX} characters`)
  .regex(MODEL_ID_PATTERN, 'A model id is one word of letters, digits and ._:/@[]-')
  .nullable()
  .openapi({ example: 'claude-opus-5-5' });

/** A reasoning effort its model takes, or null for the default. */
const effort = Effort.nullable().openapi({ example: 'high' });

/** One of your credentials, or null for none. */
const choice = z.string().nullable().openapi({ example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b' });

/** A part's subscription, gateway or sign-in as the profile shows it: what it is and whose account, never its secret. */
export const ProfileSubscriptionSchema = z
  .object({
    id: z.string(),
    kind: CredentialKind,
    label: z.string().openapi({ example: 'Max at home' }),
    accountEmail: z.string().nullable().openapi({ example: 'ihor@example.com' }),
    status: CredentialStatus,
    account: z.string().nullable().openapi({
      description:
        "A tool sign-in's account: GitHub's login, Atlassian's name (else email); null for the AI kinds",
      example: 'ihorherasko',
    }),
    site: z.string().nullable().openapi({
      description: "An Atlassian sign-in's site, a Slack sign-in's workspace; null for any other kind",
      example: 'airia.atlassian.net',
    }),
    asUser: z.boolean().optional().openapi({
      description: 'A Slack sign-in only: true for a user token (`xoxp-`), which posts as that person',
    }),
    scopes: z
      .array(z.string())
      .optional()
      .openapi({ description: "A Slack sign-in only: the token's scopes, which cap the part's rights" }),
  })
  .openapi('ProfileSubscription');

/** An agent that uses the profile, and its company. */
export const ProfileAgentSchema = z
  .object({
    companyId: z.string(),
    companySlug: z.string().openapi({ example: 'most-wanted' }),
    companyName: z.string().openapi({ example: 'Most Wanted' }),
    agentId: z.string(),
    agentName: z.string().openapi({ example: 'SLOP BOX' }),
    agentSlug: z.string().openapi({ example: 'slop-box' }),
  })
  .openapi('ProfileAgent');

/** The GitHub part's rights (the whole set); the shared schemas are cloned so the copies follow zod-openapi's zod. */
const GitHubRightsSchema = GitHubRights.clone().openapi('GitHubRights', {
  description:
    '`repos` (`all`, or `owner/name` and `owner/*`), `push` (push branches), `pullRequests` (open and update them); ' +
    'it never merges, deletes, force-pushes or pushes to a default branch',
  example: { repos: ['AiriaLLC/*'], push: true, pullRequests: true },
});

/** The Atlassian part's rights (the whole set): Jira's and Confluence's levels and where they reach. */
const AtlassianRightsSchema = AtlassianRights.clone().openapi('AtlassianRights', {
  description:
    '`jira` (off, read, changes) in `jiraProjects`, `confluence` (off, read, write) in `confluenceSpaces`, each `all` ' +
    'or keys; it never deletes or archives',
  example: { jira: 'read', jiraProjects: 'all', confluence: 'write', confluenceSpaces: ['ENG'] },
});

/** The Slack part's rights (the whole set): what it may do and in which channels; capped by its token's scopes. */
const SlackRightsSchema = SlackRights.clone().openapi('SlackRights', {
  description:
    '`read` (history, threads, channels, users), `post` (channels and threads), `channels` (`all`, or names and ids), ' +
    "`dms` (off, read, post), `search` (a user token's `search:read`), `react`; each right the token's scopes do not " +
    'allow is refused; it never mentions @here, @channel or @everyone, deletes, edits others’ messages or administers',
  example: { read: true, post: true, channels: ['general'], dms: 'off', search: false, react: false },
});

/** Each AI part's modes, cloned so the copies follow zod-openapi's zod. */
const PART_MODES = {
  claude: ClaudeMode.clone().openapi('ClaudeMode', {
    description:
      "Claude Code's permission mode: `manual` (Manual), `acceptEdits` (Accept edits), `plan` (Plan), `auto` (Auto), " +
      '`bypassPermissions` (Skip prompts, full trust)',
  }),
  openai: CodexMode.clone().openapi('CodexMode', {
    description:
      "Codex's mode: `ask` (a read-only sandbox), `auto` (its workspace), `full` (no prompts, no sandbox)",
  }),
} as const;

/**
 * An AI part as the profile shows it: its subscription (null: its agents cannot run), gateway, model, effort and the
 * permission mode its turns run in.
 */
const aiPartView = (part: string, mode: (typeof PART_MODES)[keyof typeof PART_MODES]) =>
  z
    .object({
      subscription: ProfileSubscriptionSchema.nullable(),
      gateway: ProfileSubscriptionSchema.nullable(),
      model: z.string().nullable().openapi({ description: "Its model; null: the harness's default" }),
      effort: Effort.nullable().openapi({
        description: 'Its effort, one its model takes; null: the default',
      }),
      mode,
    })
    .openapi(part);

/** A tool part as the profile shows it: its sign-in (null while it has none: no access) and its rights. */
const toolPartView = <R extends z.ZodType>(rights: R, part: string) =>
  z.object({ signIn: ProfileSubscriptionSchema.nullable(), rights }).openapi(part);

/** The profile's parts, each null when it has none. */
export const ProfilePartsSchema = z
  .object({
    claude: aiPartView('ProfileClaudePart', PART_MODES.claude).nullable(),
    openai: aiPartView('ProfileOpenaiPart', PART_MODES.openai).nullable(),
    github: toolPartView(GitHubRightsSchema, 'ProfileGitHubPart').nullable(),
    atlassian: toolPartView(AtlassianRightsSchema, 'ProfileAtlassianPart').nullable(),
    slack: toolPartView(SlackRightsSchema, 'ProfileSlackPart').nullable(),
  })
  .openapi('ProfileParts');

/**
 * An AI part in a change: a subscription of its provider, a gateway, a model, an effort and one of its own modes, each
 * optional (a new part's mode: Manual or Ask).
 */
const aiPartChoice = (mode: (typeof PART_MODES)[keyof typeof PART_MODES]) =>
  z
    .object({
      credentialId: choice.optional(),
      gatewayCredentialId: choice.optional(),
      model: model.optional(),
      effort: effort.optional(),
      mode: mode.optional(),
    })
    .strict();

/** A tool part in a change: one of your sign-ins of the tool and its whole rights, each optional. */
const toolPartChoice = <R extends z.ZodType>(rights: R) =>
  z.object({ credentialId: choice.optional(), rights: rights.optional() }).strict();

/**
 * The parts in a change: a part to add (missing fields empty, or a tool's safe rights) or change (only what it gives),
 * null to remove it, or left out to keep it.
 */
const PartsChoiceSchema = z
  .object({
    claude: aiPartChoice(PART_MODES.claude).nullable().optional(),
    openai: aiPartChoice(PART_MODES.openai).nullable().optional(),
    github: toolPartChoice(GitHubRightsSchema).nullable().optional(),
    atlassian: toolPartChoice(AtlassianRightsSchema).nullable().optional(),
    slack: toolPartChoice(SlackRightsSchema).nullable().optional(),
  })
  .strict()
  .openapi('ProfilePartsChoice');

export const AccessProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    /** Its Claude, OpenAI, GitHub, Atlassian and Slack parts. */
    parts: ProfilePartsSchema,
    /** The agents that use it, in your companies. */
    agents: z.array(ProfileAgentSchema),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('AccessProfile');

export const AccessProfileListSchema = z
  .object({ profiles: z.array(AccessProfileSchema) })
  .openapi('AccessProfileList');

/** A new profile: a name and, optionally, parts (none: a profile with nothing in it yet). */
export const CreateAccessProfileSchema = z
  .object({ name, parts: PartsChoiceSchema.optional() })
  .openapi('CreateAccessProfile');

/** A new name, parts added, changed or removed, or both. */
export const UpdateAccessProfileSchema = z
  .object({ name: name.optional(), parts: PartsChoiceSchema.optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one field to change')
  .openapi('UpdateAccessProfile');

export type AccessProfileView = z.infer<typeof AccessProfileSchema>;
export type ProfileSubscriptionView = z.infer<typeof ProfileSubscriptionSchema>;
export type ProfileAgentView = z.infer<typeof ProfileAgentSchema>;
export type ProfilePartsView = z.infer<typeof ProfilePartsSchema>;
export type CreateAccessProfile = z.infer<typeof CreateAccessProfileSchema>;
export type UpdateAccessProfile = z.infer<typeof UpdateAccessProfileSchema>;
