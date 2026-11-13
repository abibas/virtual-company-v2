import { z } from '@hono/zod-openapi';
import { AtlassianRights, GitHubRights, SlackRights } from '@mwc/shared/credentials';
import { Effort, PermissionMode, ProfileProvider } from '@mwc/shared/enums';

/**
 * The org API's shapes of access profiles (S3.4; generic profiles since 2026-11-13): the profile an agent's runs use, as
 * agents and the chart show it (its parts: what each AI part runs, who each tool part acts as and its rights; never a
 * subscription or a secret), what the agent runs on it, and a member's defaults for the agents they hire (one per AI
 * part).
 */

/** A permission mode of either harness (`@mwc/shared/modes`), as agents show it. */
const Mode = PermissionMode.clone().openapi({ example: 'manual' });

/**
 * What an AI part runs: a model and an effort, each null for the harness's default, and the permission mode its turns
 * run in (since 2026-11-13).
 */
const aiPart = (name: string) =>
  z
    .object({
      model: z.string().nullable().openapi({ example: 'claude-opus-5-5' }),
      effort: Effort.nullable().openapi({ example: 'high' }),
      mode: Mode,
    })
    .openapi(name);

/** Who a tool part's sign-in acts as (null while the part has none: no access) and where, and its rights there. */
const toolPart = <R extends z.ZodType>(rights: R, name: string) =>
  z
    .object({
      account: z.string().nullable().openapi({
        description: "GitHub's login or Atlassian's name (else email); null while the part has no sign-in",
        example: 'ihorherasko',
      }),
      site: z
        .string()
        .nullable()
        .openapi({ description: "Atlassian's site, Slack's workspace; null for GitHub", example: null }),
      rights,
      asUser: z.boolean().optional().openapi({
        description: 'Slack only: true for a user token, whose posts show as that person',
      }),
      scopes: z
        .array(z.string())
        .optional()
        .openapi({ description: "Slack only: the token's scopes, which cap the rights" }),
    })
    .openapi(name);

/** An agent's profile's parts, each null when the profile has none (the rights cloned after zod-openapi's zod). */
const AgentProfilePartsSchema = z
  .object({
    claude: aiPart('AgentClaudePart').nullable(),
    openai: aiPart('AgentOpenaiPart').nullable(),
    github: toolPart(GitHubRights.clone(), 'AgentGitHubPart').nullable(),
    atlassian: toolPart(AtlassianRights.clone(), 'AgentAtlassianPart').nullable(),
    slack: toolPart(SlackRights.clone(), 'AgentSlackPart').nullable(),
  })
  .openapi('AgentProfileParts');

/** The access profile an agent uses: its name, whose it is and its parts; never a subscription or a secret. */
export const AgentProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    ownerUserId: z.string(),
    /** The owner's first and last name, else their email. */
    ownerName: z.string().openapi({ example: 'Ihor Herasko' }),
    /** Its Claude, OpenAI, GitHub, Atlassian and Slack parts. */
    parts: AgentProfilePartsSchema,
  })
  .openapi('AgentProfile');

/**
 * What an agent's runs run (since 2026-11-10, docs/subscriptions.md "Model and effort"): the model and effort of its
 * profile's part for its harness, each null for the default, its permission mode (since 2026-11-13), and that part.
 */
export const RunsWithSchema = z
  .object({
    model: z.string().nullable().openapi({ example: 'claude-opus-5-5' }),
    effort: Effort.nullable().openapi({ example: 'high' }),
    mode: Mode,
    provider: ProfileProvider,
  })
  .openapi('RunsWith');

/** A profile in a change: one of yours to give (with the part the agent's harness runs on), or null for none. */
export const ProfileChoice = z
  .string()
  .nullable()
  .openapi({ example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f' });

/**
 * A member's default profile for the agents of one AI part they hire: Claude for Claude Code agents, OpenAI for Codex
 * agents; one of theirs with that part, or null for none.
 */
export const DefaultProfileBodySchema = z
  .object({ provider: ProfileProvider, profileId: ProfileChoice })
  .openapi('DefaultProfileChoice');

/** A member's defaults here, one per AI part. */
export const DefaultProfileSchema = z
  .object({
    defaultClaudeProfileId: z.string().nullable(),
    defaultOpenaiProfileId: z.string().nullable(),
  })
  .openapi('DefaultProfiles');

export type AgentProfileView = z.infer<typeof AgentProfileSchema>;
export type AgentProfilePartsView = z.infer<typeof AgentProfilePartsSchema>;
export type RunsWithView = z.infer<typeof RunsWithSchema>;
export type DefaultProfileView = z.infer<typeof DefaultProfileSchema>;
