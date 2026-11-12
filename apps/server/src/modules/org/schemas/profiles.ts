import { z } from '@hono/zod-openapi';
import { AtlassianRights, GitHubRights } from '@mwc/shared/credentials';
import { AiProvider, Effort, ProfileProvider, ToolProvider } from '@mwc/shared/enums';

/**
 * The org API's shapes of access profiles (S3.4, one provider each since 2026-11-10): the profile an agent's runs use,
 * as agents and the chart show it (never a subscription of it) with what it runs, its GitHub and Atlassian profiles
 * (S7.1b) with the account they act as and their rights, a member's defaults for the agents they hire (one per AI
 * provider), and the note of a profile a harness change took off an agent.
 */

/** The access profile an agent uses: its name, provider and whose it is, never its subscriptions. */
export const AgentProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'Work' }),
    /** Claude for a Claude Code agent, OpenAI for a Codex one. */
    provider: ProfileProvider,
    ownerUserId: z.string(),
    /** The owner's first and last name, else their email. */
    ownerName: z.string().openapi({ example: 'Ihor Herasko' }),
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
    provider: AiProvider,
  })
  .openapi('RunsWith');

/**
 * A GitHub or Atlassian profile an agent has (S7.1b): its name, tool and owner, who its sign-in acts as (null while it
 * has none) and where, and its rights; never its sign-in's secret.
 */
export const AgentToolProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: 'AiriaLLC push' }),
    provider: ToolProvider,
    ownerUserId: z.string(),
    /** The owner's first and last name, else their email. */
    ownerName: z.string().openapi({ example: 'Ihor Herasko' }),
    account: z.string().nullable().openapi({
      description: "GitHub's login or Atlassian's name (else email); null while the profile has no sign-in",
      example: 'ihorherasko',
    }),
    site: z.string().nullable().openapi({ description: "Atlassian's site; null for GitHub", example: null }),
    /** Its rights there (`ToolRights` of `@mwc/shared/credentials`, made after zod-openapi extends zod). */
    rights: z.union([GitHubRights, AtlassianRights]).openapi({
      example: { repos: ['AiriaLLC/*'], push: true, pullRequests: true },
    }),
  })
  .openapi('AgentToolProfile');

/**
 * A profile in a change: one of yours to give (of the agent's harness's provider; of the tool, for a GitHub or Atlassian
 * profile), or null for none.
 */
export const ProfileChoice = z
  .string()
  .nullable()
  .openapi({ example: '019a5b20-1a2b-7c3d-8e4f-5a6b7c8d9e0f' });

/**
 * A member's default profile of one provider for the agents they hire: Claude for Claude Code agents, OpenAI for Codex
 * agents; one of theirs of that provider, or null for none.
 */
export const DefaultProfileBodySchema = z
  .object({ provider: AiProvider, profileId: ProfileChoice })
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
export type AgentToolProfileView = z.infer<typeof AgentToolProfileSchema>;
export type DefaultProfileView = z.infer<typeof DefaultProfileSchema>;
export type ProfileClearedView = z.infer<typeof ProfileClearedSchema>;
