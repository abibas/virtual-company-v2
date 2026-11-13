import { z } from '@hono/zod-openapi';
import { AtlassianRights, GitHubRights } from '@mwc/shared/credentials';
import { Effort, ProfileProvider } from '@mwc/shared/enums';

/**
 * The org API's shapes of access profiles (S3.4, one provider each since 2026-11-10): the profile an agent's runs use,
 * as agents and the chart show it (the accounts it acts as, never a secret) with what it runs and its GitHub and
 * Atlassian parts (S7.1b, one profile since 2026-11-13), a member's defaults for the agents they hire (one per
 * provider), and the note of a profile a harness change took off an agent.
 */

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
        .openapi({ description: "Atlassian's site; null for GitHub", example: null }),
      rights,
    })
    .openapi(name);

/** An agent's profile's tool parts, each null when the profile has none (the rights cloned after zod-openapi's zod). */
const AgentProfileToolsSchema = z
  .object({
    github: toolPart(GitHubRights.clone(), 'AgentGitHubPart').nullable(),
    atlassian: toolPart(AtlassianRights.clone(), 'AgentAtlassianPart').nullable(),
  })
  .openapi('AgentProfileTools');

/**
 * The access profile an agent uses: its name, provider and whose it is, the account its subscription acts as and its
 * tool parts; never a secret.
 */
export const AgentProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    /** Claude for a Claude Code agent, OpenAI for a Codex one. */
    provider: ProfileProvider,
    ownerUserId: z.string(),
    /** The owner's first and last name, else their email. */
    ownerName: z.string().openapi({ example: 'Ihor Herasko' }),
    account: z.string().nullable().openapi({
      description: "Its subscription's account email; null without a subscription, or one that names none",
      example: 'ihorherasko@airia.ai',
    }),
    /** Its GitHub and Atlassian parts: what the agent may do there and as whom. */
    tools: AgentProfileToolsSchema,
  })
  .openapi('AgentProfile');

/**
 * What an agent's runs run (since 2026-11-10, docs/subscriptions.md "Model and effort"): its access profile's model and
 * effort, each null for the provider's default, and the provider.
 */
export const RunsWithSchema = z
  .object({
    model: z.string().nullable().openapi({ example: 'claude-opus-5-5' }),
    effort: Effort.nullable().openapi({ example: 'high' }),
    provider: ProfileProvider,
  })
  .openapi('RunsWith');

/** A profile in a change: one of yours to give (of the agent's harness's provider), or null for none. */
export const ProfileChoice = z
  .string()
  .nullable()
  .openapi({ example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f' });

/**
 * A member's default profile of one provider for the agents they hire: Claude for Claude Code agents, OpenAI for Codex
 * agents; one of theirs of that provider, or null for none.
 */
export const DefaultProfileBodySchema = z
  .object({ provider: ProfileProvider, profileId: ProfileChoice })
  .openapi('DefaultProfileChoice');

/** A member's defaults here, one per provider. */
export const DefaultProfileSchema = z
  .object({
    defaultClaudeProfileId: z.string().nullable(),
    defaultOpenaiProfileId: z.string().nullable(),
  })
  .openapi('DefaultProfiles');

/** A profile a harness change took off an agent: it was of the other provider. */
export const ProfileClearedSchema = z
  .object({
    profileId: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    message: z.string().openapi({
      example:
        'Its access profile Work is for Claude, so it was taken off: a Codex agent needs an OpenAI profile',
    }),
  })
  .openapi('ProfileCleared');

export type AgentProfileView = z.infer<typeof AgentProfileSchema>;
export type RunsWithView = z.infer<typeof RunsWithSchema>;
export type AgentProfileToolsView = z.infer<typeof AgentProfileToolsSchema>;
export type DefaultProfileView = z.infer<typeof DefaultProfileSchema>;
export type ProfileClearedView = z.infer<typeof ProfileClearedSchema>;
