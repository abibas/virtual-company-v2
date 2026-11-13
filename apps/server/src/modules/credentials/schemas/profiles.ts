import { z } from '@hono/zod-openapi';
import { ACCESS_PROFILE_NAME, AtlassianRights, GitHubRights } from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus, Effort, ProfileProvider } from '@mwc/shared/enums';
import { MODEL_ID_MAX, MODEL_ID_PATTERN } from '@mwc/shared/models';

/**
 * The access profiles API's shapes (`/api/me/access-profiles`, S3.4, one provider each since 2026-11-10): a person's
 * named choice of one of their own subscriptions, Claude's or OpenAI's, with an optional gateway, and (since
 * 2026-11-10) the model and effort its runs use; since 2026-11-13 also its optional tool parts (S7.1b reshaped), a
 * GitHub and an Atlassian part, each one of the person's sign-ins of that tool with the rights the agents given the
 * profile have there. A credential shows its metadata, never a secret.
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

/** Whose subscription it holds, Claude's or OpenAI's: fixed when it is made. */
const provider = ProfileProvider;

/** A model id (one of the catalogue's of the profile's provider, or another), or null for the provider's default. */
const model = z
  .string()
  .trim()
  .min(1, 'A model id is required')
  .max(MODEL_ID_MAX, `A model id is at most ${MODEL_ID_MAX} characters`)
  .regex(MODEL_ID_PATTERN, 'A model id is one word of letters, digits and ._:/@[]-')
  .nullable()
  .openapi({ example: 'claude-opus-5-5' });

/** A reasoning effort its model takes, or null for the provider's default. */
const effort = Effort.nullable().openapi({ example: 'high' });

/** One of your subscriptions, or null to empty the profile's. */
const choice = z.string().nullable().openapi({ example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b' });

/** A profile's subscription, gateway or tool part's sign-in as it shows it: what it is and whose account, never its secret. */
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
      description: "An Atlassian sign-in's site; null for any other kind",
      example: 'airia.atlassian.net',
    }),
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

/**
 * The GitHub part's rights as the API shows and takes them (the whole set): reading always, in `repos`. The shared
 * schemas are cloned so the copies are made after zod-openapi extends zod.
 */
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

/** A tool part as the profile shows it: its sign-in (null while it has none: no access) and its rights. */
const toolPartView = <R extends z.ZodType>(rights: R, name: string) =>
  z.object({ signIn: ProfileSubscriptionSchema.nullable(), rights }).openapi(name);

/** The profile's tool parts, each null when it has none. */
export const ProfileToolsSchema = z
  .object({
    github: toolPartView(GitHubRightsSchema, 'ProfileGitHubPart').nullable(),
    atlassian: toolPartView(AtlassianRightsSchema, 'ProfileAtlassianPart').nullable(),
  })
  .openapi('ProfileTools');

/** A tool part in a change: one of your sign-ins of the tool (null for none, left out to keep it) and its whole rights. */
const toolPartChoice = <R extends z.ZodType>(rights: R) =>
  z.object({ credentialId: choice.optional(), rights: rights.optional() }).strict();

/**
 * The tool parts in a change: a part to add (its rights default to the tool's safe ones) or change, null to remove it,
 * or left out to keep it.
 */
const ToolPartsChoiceSchema = z
  .object({
    github: toolPartChoice(GitHubRightsSchema).nullable().optional(),
    atlassian: toolPartChoice(AtlassianRightsSchema).nullable().optional(),
  })
  .strict()
  .openapi('ProfileToolsChoice');

export const AccessProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    /** Claude for `claude_code` agents, OpenAI for `codex` agents. */
    provider: ProfileProvider,
    /** Its subscription of that provider; null while it has none (it cannot run until it does). */
    subscription: ProfileSubscriptionSchema.nullable(),
    /** Its gateway (any), which its runs send their AI requests through; null for none. */
    gateway: ProfileSubscriptionSchema.nullable(),
    model: z.string().nullable().openapi({
      description:
        "The model its runs use: one of its provider's in the catalogue, or another id; null: the provider's default",
      example: 'claude-opus-5-5',
    }),
    effort: Effort.nullable().openapi({
      description: "The reasoning effort its runs use, one its model takes; null: the provider's default",
    }),
    /** Its GitHub and Atlassian parts. */
    tools: ProfileToolsSchema,
    /** The agents that use it, in your companies. */
    agents: z.array(ProfileAgentSchema),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('AccessProfile');

export const AccessProfileListSchema = z
  .object({ profiles: z.array(AccessProfileSchema) })
  .openapi('AccessProfileList');

/**
 * A new profile: a name, its provider and, optionally, one of your subscriptions of that provider and any of your
 * gateways, a model and an effort (none: the provider's defaults), and tool parts (none: no GitHub or Atlassian access).
 */
export const CreateAccessProfileSchema = z
  .object({
    name,
    provider,
    credentialId: choice.optional(),
    gatewayCredentialId: choice.optional(),
    model: model.optional(),
    effort: effort.optional(),
    tools: ToolPartsChoiceSchema.optional(),
  })
  .openapi('CreateAccessProfile');

/**
 * A new name, another subscription of the same provider or another gateway, another model or effort, tool parts added,
 * changed or removed, any of them (null empties one, or goes back to the provider's default). The provider is fixed:
 * given, it must be the profile's own.
 */
export const UpdateAccessProfileSchema = z
  .object({
    name: name.optional(),
    provider: provider.optional(),
    credentialId: choice.optional(),
    gatewayCredentialId: choice.optional(),
    model: model.optional(),
    effort: effort.optional(),
    tools: ToolPartsChoiceSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one field to change')
  .openapi('UpdateAccessProfile');

export type AccessProfileView = z.infer<typeof AccessProfileSchema>;
export type ProfileSubscriptionView = z.infer<typeof ProfileSubscriptionSchema>;
export type ProfileAgentView = z.infer<typeof ProfileAgentSchema>;
export type ProfileToolsView = z.infer<typeof ProfileToolsSchema>;
export type CreateAccessProfile = z.infer<typeof CreateAccessProfileSchema>;
export type UpdateAccessProfile = z.infer<typeof UpdateAccessProfileSchema>;
