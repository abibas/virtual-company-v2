import type { PermissionMode, ProfileProvider, ToolProvider } from '@mwc/shared/enums';
import { DEFAULT_MODES } from '@mwc/shared/modes';
import type { AccessProfile } from './schema/credentials.ts';

/**
 * Each part's columns on `access_profiles` (migration `0032_generic_profiles`): an AI part's presence, subscription,
 * gateway, model, effort and mode (since 2026-11-13); a tool part's sign-in and rights. The credentials, org and chats modules read and write the
 * parts through these maps, so a later tool (Slack, S7.1e) is its two columns and an entry in `PROFILE_TOOL_COLUMNS`.
 * Kept out of the schema's barrel, which holds tables only.
 */
export const PROFILE_AI_COLUMNS = {
  claude: {
    part: 'claudePart',
    credential: 'claudeCredentialId',
    gateway: 'claudeGatewayCredentialId',
    model: 'claudeModel',
    effort: 'claudeEffort',
    mode: 'claudeMode',
  },
  openai: {
    part: 'openaiPart',
    credential: 'openaiCredentialId',
    gateway: 'openaiGatewayCredentialId',
    model: 'openaiModel',
    effort: 'openaiEffort',
    mode: 'openaiMode',
  },
} as const satisfies Record<
  ProfileProvider,
  {
    readonly part: keyof AccessProfile;
    readonly credential: keyof AccessProfile;
    readonly gateway: keyof AccessProfile;
    readonly model: keyof AccessProfile;
    readonly effort: keyof AccessProfile;
    readonly mode: keyof AccessProfile;
  }
>;

/** Each tool part's two columns: its sign-in and its rights (null rights: no such part). */
export const PROFILE_TOOL_COLUMNS = {
  github: { credential: 'githubCredentialId', rights: 'githubRights' },
  atlassian: { credential: 'atlassianCredentialId', rights: 'atlassianRights' },
} as const satisfies Record<
  ToolProvider,
  { readonly credential: keyof AccessProfile; readonly rights: keyof AccessProfile }
>;

/** What one AI part of a profile holds, read from its columns; undefined when the profile has no such part. */
export interface AiPartRow {
  readonly credentialId: string | null;
  readonly gatewayCredentialId: string | null;
  readonly model: string | null;
  readonly effort: AccessProfile['claudeEffort'];
  /** Its permission mode: the stored one, else the part's default (Manual, Ask). */
  readonly mode: PermissionMode;
}

/** A profile's AI part of `provider` (the one a harness runs on), or undefined when it has none. */
export function aiPartOf(profile: AccessProfile, provider: ProfileProvider): AiPartRow | undefined {
  const columns = PROFILE_AI_COLUMNS[provider];
  if (!profile[columns.part]) return undefined;
  return {
    credentialId: profile[columns.credential],
    gatewayCredentialId: profile[columns.gateway],
    model: profile[columns.model],
    effort: profile[columns.effort],
    mode: profile[columns.mode] ?? DEFAULT_MODES[provider],
  };
}
