import type { ToolProvider } from '@mwc/shared/enums';
import type { AccessProfile } from './schema/credentials.ts';

/**
 * Each tool part's two columns on `access_profiles` (migration `0032_profile_tool_parts`): its sign-in and its rights.
 * The credentials module writes them and the org module reads them through this one map, so a later tool (Slack, S7.1e)
 * is its two columns and an entry here. Kept out of the schema's barrel, which holds tables only.
 */
export const PROFILE_TOOL_COLUMNS = {
  github: { credential: 'githubCredentialId', rights: 'githubRights' },
  atlassian: { credential: 'atlassianCredentialId', rights: 'atlassianRights' },
} as const satisfies Record<
  ToolProvider,
  { readonly credential: keyof AccessProfile; readonly rights: keyof AccessProfile }
>;
