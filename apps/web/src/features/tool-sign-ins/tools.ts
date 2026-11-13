import type { ToolCredentialKind } from '@mwc/shared/credentials';
import type { Subscription } from '../../api/types.ts';

/**
 * How a tool sign-in reads on its card (S7.1a): who it acts as, and what it reaches, GitHub's scopes, which Atlassian
 * products answered, or a Slack token's scopes (S7.1e), from the account details the server keeps (`accountMeta`).
 */

/** A tool sign-in: a subscription of a tool kind. */
export type ToolSignIn = Subscription & { readonly kind: ToolCredentialKind };

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** Who it acts as: GitHub's "@login · Name", Atlassian's "Name · email", Slack's "Bot · mw-bot" or "User · ihor". */
export function toolAccount(tool: ToolSignIn): string {
  const meta = tool.accountMeta;
  if (tool.kind === 'slack_bot_token' || tool.kind === 'slack_user_token') {
    const who = text(meta.user);
    return who === undefined ? '' : `${tool.kind === 'slack_bot_token' ? 'Bot' : 'User'} · ${who}`;
  }
  const parts =
    tool.kind === 'atlassian_api_token'
      ? [text(meta.displayName), tool.accountEmail ?? undefined]
      : [text(meta.login) && `@${text(meta.login)}`, text(meta.name)];
  return parts.filter((part): part is string => part !== undefined).join(' · ');
}

/** What a sign-in reaches, as chips: each name, and whether it is there. */
export interface Reach {
  readonly name: string;
  readonly on: boolean;
}

/** GitHub's scopes (a fine-grained token has permissions instead), or Jira and Confluence with whether each answers. */
export function toolReach(tool: ToolSignIn): readonly Reach[] {
  const meta = tool.accountMeta;
  if (tool.kind === 'atlassian_api_token') {
    return [
      { name: 'Jira', on: meta.jira === true },
      { name: 'Confluence', on: meta.confluence === true },
    ];
  }
  if (Array.isArray(meta.scopes)) return meta.scopes.map((scope) => ({ name: String(scope), on: true }));
  return meta.tokenType === 'fine_grained' ? [{ name: 'Fine-grained', on: true }] : [];
}

/** The Atlassian site it signs in to, or the Slack workspace. */
export const toolSite = (tool: ToolSignIn): string | undefined =>
  text(tool.accountMeta.site) ?? text(tool.accountMeta.team);
