import { type ClientResponse, DetailedError, parseResponse } from 'hono/client';

/**
 * A refusal or failure of an API call: the HTTP status (0 when the server was not reached), the error code, and the
 * command to run instead when the refusal names one (`update_unsupported`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly command: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string, command?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.command = command;
  }
}

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
    readonly command?: unknown;
  };
}

function isErrorBody(value: unknown): value is ErrorBody {
  const error = (value as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

function toApiError(error: unknown): ApiError {
  if (error instanceof DetailedError) {
    const status = Number(error.statusCode ?? 0);
    const body: unknown = (error.detail as { data?: unknown } | undefined)?.data;
    if (isErrorBody(body)) {
      const { code, message, requestId, command } = body.error;
      return new ApiError(
        status,
        code,
        message,
        requestId,
        typeof command === 'string' ? command : undefined,
      );
    }
    return new ApiError(status, 'http_error', `The server answered ${status}`);
  }
  if (error instanceof SyntaxError)
    return new ApiError(0, 'bad_response', 'The server sent an answer that is not JSON');
  return new ApiError(0, 'network', 'The server could not be reached');
}

/**
 * Awaits a typed client call and returns its success body (undefined for 204), or throws an `ApiError` with the
 * server's error code and message (`{ error: { code, message, requestId } }`).
 */
export async function call<R extends ClientResponse<unknown>>(request: R | Promise<R>) {
  try {
    return await parseResponse(request);
  } catch (error) {
    throw toApiError(error);
  }
}

/** What the people using the app read for the server's refusals; codes not listed show the server's own message. */
const FRIENDLY: Readonly<Record<string, string>> = {
  last_owner: 'A company needs at least one active owner. Make someone else an owner first.',
  already_member: 'Someone with this email is already a member.',
  invitation_pending: 'This email already has a pending invitation. Resend that one instead.',
  invitation_not_pending: 'This invitation is no longer pending. Refresh the list to see where it stands.',
  invitation_not_found: 'This invitation no longer exists. Refresh the list.',
  member_not_found: 'This person is no longer a member. Refresh the list.',
  api_key_not_found: 'This key no longer exists. Refresh the list.',
  agent_not_found: 'There is no agent here. It may have been renamed; open it from the list of agents.',
  agent_slug_taken: 'Another agent already has this address. Choose another one.',
  position_not_found: 'This person or agent is no longer on the chart. Refresh the chart.',
  confirmation_mismatch: 'The name you typed does not match the company name.',
  slug_taken: 'That address is taken. Choose another one.',
  logo_too_large: 'The logo is over 1 MB. Choose a smaller image.',
  logo_type_unsupported: 'The logo must be a PNG, JPEG or WebP image.',
  logo_empty: 'The logo file is empty. Choose an image.',
  logo_not_found: 'This company has no logo.',
  company_creation_disabled: 'Creating companies is switched off on this server.',
  company_creation_not_allowed:
    'Your account may not create companies on this server. Ask a company admin to invite you instead.',
  user_not_linked: 'Your sign-in is not finished yet. Reload the page and try again.',
  session_pending: 'Your sign-in has a step left to finish. Finish it, then try again.',
  user_deactivated: 'This account is deactivated. Ask an administrator to restore it.',
  identity_not_configured: 'Sign-in is not configured on this server.',
  identity_unavailable: 'The sign-in service is not answering right now. Try again in a moment.',
  unauthenticated: 'Your session has ended. Sign in again.',
  not_found: 'This company does not exist, or you are no longer a member of it.',
  session_required:
    'Subscriptions and access profiles are managed signed in to the web app, never with an API key.',
  sign_in_active:
    'A sign-in is already open. Finish or cancel it, or wait for it to end (10 minutes at most).',
  sign_in_unavailable: 'Sign-in isn’t available on this server (Docker isn’t running?).',
  sign_in_not_found: 'This sign-in has ended (the server may have restarted). Start again.',
  sign_in_not_waiting: 'The sign-in is not asking for a code yet. Wait a moment and send it again.',
  sign_in_kind_mismatch: 'This subscription was not added with this sign-in. Sign in with its own provider.',
  credential_not_found: 'This subscription no longer exists. Refresh the page.',
  credential_kind_mismatch: 'That subscription does not fit this slot. Choose one of the kind it takes.',
  credential_revoked: 'That subscription is revoked. Choose another one.',
  access_profile_not_found: 'This access profile no longer exists. Refresh the page.',
  access_profile_name_taken: 'You already have an access profile with this name. Choose another one.',
  profile_not_yours: 'Only the owner of an access profile can give it to an agent.',
  profile_not_found: 'That access profile no longer exists. Choose another one.',
  network: 'The server could not be reached. Check that it is running and try again.',
  bad_response: 'The server sent an unexpected answer. Try again in a moment.',
  internal: 'The server ran into a problem. Try again in a moment.',
};

/** A plain sentence for an error, for the page that made the call. */
export function friendlyMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.code === 'invalid_request') {
    // zod's report: "✖ message\n  → at field" lines; keep the messages.
    const lines = error.message.split('\n').filter((line) => line.startsWith('✖'));
    return `Check the form: ${lines.map((line) => line.replace(/^✖\s*/, '')).join('; ') || error.message}`;
  }
  return FRIENDLY[error.code] ?? error.message;
}

/** True when the error is this API refusal. */
export function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
