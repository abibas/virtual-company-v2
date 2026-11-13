import {
  type SlackCapability,
  type SlackRights,
  slackGap,
  slackGapWords,
  slackScopesOf,
  storedRights,
} from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { type ProfileRefusal, refuse } from './profiles.ts';

/**
 * A profile's Slack part against its token's scopes (S7.1e, docs/subscriptions.md "Slack"): a change that turns on a
 * right the part's sign-in cannot use is refused (422 `slack_scope_missing`), naming what the token lacks. Only rights a
 * request gives are checked, and only those it turns on: a right already on stays (the tools refuse it while the token
 * lacks its scopes), and a new part's safe defaults or a new sign-in alone are never refused. Pure.
 */

/** Each capability as the pages name its right. */
export const SLACK_RIGHT_NAMES: Readonly<Record<SlackCapability, string>> = {
  read: 'Read',
  privateChannels: 'Private channels',
  users: 'Users',
  post: 'Post',
  customize: 'Posting under the agent’s name',
  dmsRead: 'Reading DMs',
  dmsPost: 'Posting DMs',
  search: 'Search',
  react: 'React',
};

/** The capabilities `after` turns on that `before` (the stored rights; null for a new part) had off. */
export function slackTurnedOn(before: SlackRights | null, after: SlackRights): SlackCapability[] {
  const was = before ?? storedRights('slack', null);
  const on: SlackCapability[] = [];
  for (const right of ['read', 'post', 'search', 'react'] as const)
    if (after[right] && !was[right]) on.push(right);
  if (after.dms !== 'off' && was.dms === 'off') on.push('dmsRead');
  if (after.dms === 'post' && was.dms !== 'post') on.push('dmsPost');
  return on;
}

/** The sign-in a Slack part holds, as the check reads it: its kind and account details (its scopes). */
export interface SlackSignInRow {
  readonly kind: CredentialKind;
  readonly accountMeta: Readonly<Record<string, unknown>>;
}

/** Why the rights `after` may not be turned on with this sign-in, or undefined (none, or it allows them). */
export function slackScopeRefusal(
  before: SlackRights | null,
  after: SlackRights,
  signIn: SlackSignInRow | undefined,
): ProfileRefusal<422> | undefined {
  if (signIn === undefined) return undefined;
  const scopes = slackScopesOf(signIn.accountMeta);
  for (const capability of slackTurnedOn(before, after)) {
    const gap = slackGap(capability, signIn.kind, scopes);
    if (gap === undefined) continue;
    const fix = gap.userToken
      ? 'add a user token with it'
      : 'add the scope to the Slack app, reinstall it and add the new token';
    return refuse(
      422,
      'slack_scope_missing',
      `${SLACK_RIGHT_NAMES[capability]} ${slackGapWords(gap)}, which this Slack sign-in lacks: ${fix}`,
    );
  }
  return undefined;
}
