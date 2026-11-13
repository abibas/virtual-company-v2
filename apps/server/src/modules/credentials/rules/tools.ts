import {
  isToolKind,
  TOOL_PROVIDER_OF,
  type ToolCredentialKind,
  type ToolProvider,
} from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus, ToolCheckError } from '@mwc/shared/enums';
import type { AccountMeta } from '../schemas.ts';

/**
 * The tool sign-ins' pure rules (S7.1a, docs/subscriptions.md "Tool sign-ins"): what a check with GitHub, Atlassian or
 * Slack (S7.1e) found, how an answer's status reads, when the daily check is due, and the refusals in plain words.
 */

/** The tool's name in what the person reads. */
export const TOOL_NAMES: Readonly<Record<ToolProvider, string>> = {
  github: 'GitHub',
  atlassian: 'Atlassian',
  slack: 'Slack',
};

/** The name of the tool a kind signs in to. */
export const toolNameOf = (kind: ToolCredentialKind): string => TOOL_NAMES[TOOL_PROVIDER_OF[kind]];

/** A check that did not finish (`ToolCheckError`), or one the provider answered with a 401: sign in again. */
export type ToolFailure = ToolCheckError | 'needs_sign_in';

/** What a check with the provider found: who the sign-in acts as, or why it could not tell. */
export type ToolOutcome =
  | { readonly ok: true; readonly accountEmail: string | null; readonly accountMeta: AccountMeta }
  | { readonly ok: false; readonly code: ToolFailure };

/** An answer's status as a failure: 401 sign in again, 429 rate limited, 403 refused, 5xx unavailable, else odd. */
export function toolFailureOf(status: number): ToolFailure {
  if (status === 401) return 'needs_sign_in';
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'refused';
  if (status >= 500) return 'provider_unavailable';
  return 'invalid_response';
}

const HOUR = 60 * 60_000;

/** How often the daily check checks each tool sign-in, and how soon it tries again after a check that did not finish. */
export const TOOL_CHECK_EVERY_MS = 24 * HOUR;
export const TOOL_RETRY_MS = HOUR;

/** What decides whether a sign-in is due: its kind, its status and its last check. */
export interface ToolCheckState {
  readonly kind: CredentialKind;
  readonly status: CredentialStatus;
  readonly checkedAt: Date | null;
  readonly checkError: ToolCheckError | null;
}

/**
 * Whether the daily check checks a sign-in at `now`: a tool sign-in that is not revoked, never checked, last checked a
 * day ago or more, or an hour ago or more when that check did not finish. One that needs signing in again is checked
 * daily too, so a token that works again turns active.
 */
export function toolCheckDue(state: ToolCheckState, now: Date): boolean {
  if (!isToolKind(state.kind) || state.status === 'revoked') return false;
  if (state.checkedAt === null) return true;
  const age = now.getTime() - state.checkedAt.getTime();
  return age >= TOOL_CHECK_EVERY_MS || (state.checkError !== null && age >= TOOL_RETRY_MS);
}

/** Why the last check did not finish, in plain words, as a card shows it. */
export function toolCheckMessage(kind: ToolCredentialKind, code: ToolCheckError): string {
  const name = toolNameOf(kind);
  switch (code) {
    case 'provider_unavailable':
      return `${name} did not answer the last check.`;
    case 'rate_limited':
      return `${name} rate limited the last check.`;
    case 'refused':
      return `${name} refused the last check.`;
    case 'invalid_response':
      return `${name} answered the last check with something unexpected.`;
    case 'no_products':
      return 'Neither Jira nor Confluence answered on this site.';
    case 'check_failed':
      return 'The last check failed.';
  }
}

/** A tool sign-in the routes refuse, in the common error shape. */
export interface ToolRefusal<S extends 404 | 422 | 502 = 404 | 422 | 502> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

const refusal = <S extends 404 | 422 | 502>(status: S, code: string, message: string): ToolRefusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

/** What the provider said when a sign-in was added or renewed, as the person reads it; `site` names Atlassian's. */
export function addRefusal(
  kind: ToolCredentialKind,
  code: ToolFailure,
  site?: string,
): ToolRefusal<422 | 502> {
  const name = toolNameOf(kind);
  const what = kind === 'atlassian_api_token' ? 'this email and API token' : 'this token';
  const where = site === undefined ? '' : ` on ${site}`;
  switch (code) {
    case 'needs_sign_in':
      return refusal(422, 'tool_sign_in_refused', `${name} did not accept ${what}${where}.`);
    case 'refused':
      return refusal(422, 'tool_sign_in_refused', `${name} refused ${what}${where}.`);
    case 'no_products':
      return refusal(422, 'tool_sign_in_refused', `Neither Jira nor Confluence answered${where}.`);
    case 'rate_limited':
      return refusal(502, code, `${name} rate limited the check. Try again later.`);
    case 'provider_unavailable':
      return refusal(502, code, `${name} did not answer${where}. Try again.`);
    case 'invalid_response':
      return refusal(502, code, `${name} answered with something unexpected. Try again.`);
    case 'check_failed':
      return refusal(502, code, 'The check failed. Try again.');
  }
}

/** Another person's sign-in, a removed one, or no such id. */
export const TOOL_NOT_FOUND: ToolRefusal<404> = refusal(404, 'credential_not_found', 'No such sign-in');

/** Check again, or a renewal, on an AI subscription. */
export const NOT_A_TOOL: ToolRefusal<422> = refusal(
  422,
  'not_a_tool',
  'Only a GitHub, Atlassian or Slack sign-in is checked here',
);

/** A renewal with a token of another kind than the sign-in it renews. */
export const TOOL_KIND_MISMATCH: ToolRefusal<422> = refusal(
  422,
  'tool_kind_mismatch',
  'Sign in again with the same kind of sign-in',
);

export const TOOL_REVOKED: ToolRefusal<422> = refusal(
  422,
  'credential_revoked',
  'This sign-in was revoked; add it again',
);
