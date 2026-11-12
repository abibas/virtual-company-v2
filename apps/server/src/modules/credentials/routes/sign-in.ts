import { createRoute } from '@hono/zod-openapi';
import type { AuthDeps } from '../../../platform/auth/authn.ts';
import { type PersonalPath, personalRoute } from '../../../platform/auth/personal.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import type { Keyring } from '../../../platform/secrets/keyring.ts';
import { SignInCodeSchema, SignInParamsSchema, SignInSchema, StartSignInSchema } from '../schemas/sign-in.ts';
import { type SignInDeps, signInService } from '../service/sign-in.ts';

/**
 * `/api/me/subscriptions/sign-in`: Sign in with Claude and Sign in with OpenAI (S3.2, docs/subscriptions.md), and Sign
 * in with GitHub (S7.1a). The official CLI's login runs in a throwaway sandbox; the web polls the sign-in every 2
 * seconds for the provider's address (and OpenAI's or GitHub's code), sends back the code Claude's page shows, and gets the stored subscription's id. Personal
 * and session-only, like the rest of `/api/me/subscriptions`: an API key is refused (403 `session_required`).
 */

const SIGN_IN = '/api/me/subscriptions/sign-in' as const;
const ONE = `${SIGN_IN}/{signInId}` as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const NOT_FOUND = errorResponse(
  "No such sign-in of yours (`sign_in_not_found`); another person's is the same",
);

const signInRoute = <P extends PersonalPath>(deps: AuthDeps, path: P) =>
  personalRoute(deps, { path, tag: 'subscriptions' });

const startRoute = (deps: AuthDeps) => {
  const { base, refusals } = signInRoute(deps, SIGN_IN);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Start Sign in with Claude, with OpenAI or with GitHub',
    description:
      "Starts the provider's official CLI login in a throwaway sandbox and answers at once, `starting`. Poll the " +
      "sign-in for the address to open (and OpenAI's or GitHub's one-time code). It ends within 10 minutes. With " +
      "`credentialId` it signs in again: the login replaces that subscription's secret in place, keeping its id, " +
      'name and access profiles.',
    request: { body: jsonBody(StartSignInSchema) },
    responses: {
      201: jsonResponse('The sign-in, starting', SignInSchema),
      400: INVALID,
      ...refusals,
      404: errorResponse(
        "`credentialId` is no subscription of yours (`credential_not_found`); another person's is the same",
      ),
      409: errorResponse('You are already signing in (`sign_in_active`): finish or cancel it first'),
      422: errorResponse(
        "`credentialId` is another provider's kind (`sign_in_kind_mismatch`: Claude signs in again to " +
          '`claude_oauth`, OpenAI to `codex_oauth`, GitHub to `github_oauth`) or revoked (`credential_revoked`)',
      ),
      503: errorResponse(
        'Sign-in is off on this server (`identity_not_configured`), or signing in with a subscription is ' +
          '(`sign_in_unavailable`, MWC_LOGIN_HELPER=none)',
      ),
    },
  });
};

const readRoute = (deps: AuthDeps) => {
  const { base, refusals } = signInRoute(deps, ONE);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'One of your sign-ins, as it stands',
    request: { params: SignInParamsSchema },
    responses: { 200: jsonResponse('The sign-in', SignInSchema), ...refusals, 404: NOT_FOUND },
  });
};

const codeRoute = (deps: AuthDeps) => {
  const { base, refusals } = signInRoute(deps, `${ONE}/code`);
  return createRoute({
    ...base,
    method: 'post',
    summary: "Send the code Claude's page showed after you approved",
    description:
      'Typed into the Claude login; the sign-in then moves to `completing`. Never stored or logged.',
    request: { params: SignInParamsSchema, body: jsonBody(SignInCodeSchema) },
    responses: {
      200: jsonResponse('The sign-in, completing', SignInSchema),
      400: INVALID,
      ...refusals,
      404: NOT_FOUND,
      409: errorResponse('This sign-in is not waiting for a code (`sign_in_not_waiting`)'),
    },
  });
};

const cancelRoute = (deps: AuthDeps) => {
  const { base, refusals } = signInRoute(deps, ONE);
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Cancel one of your sign-ins',
    description: 'Its sandbox is killed. A sign-in that has ended stays as it was.',
    request: { params: SignInParamsSchema },
    responses: { 200: jsonResponse('The sign-in, cancelled', SignInSchema), ...refusals, 404: NOT_FOUND },
  });
};

/** The caller of a personal route: the signed-in person and the request. */
const callerOf = (v: { userId: string; requestId: string }) => ({ userId: v.userId, requestId: v.requestId });

/**
 * The routes on the server's deps, the master keyring and the configured helper (undefined: MWC_LOGIN_HELPER=none). The
 * sign-ins in progress are cancelled, and their sandboxes killed, when the server shuts down (`onShutdown`).
 */
export function signInRoutes(
  deps: Omit<ServerDeps, 'loginHelper'> & { readonly keyring: Keyring } & Pick<SignInDeps, 'loginHelper'>,
) {
  const signIns = signInService(deps);
  deps.onShutdown?.(signIns.shutdown);
  return newRouter()
    .openapi(startRoute(deps), async (c) => {
      const { credentialId, ...body } = c.req.valid('json');
      const caller = callerOf(c.var);
      const result =
        credentialId === undefined
          ? signIns.start(caller, body)
          : await signIns.signInAgain(caller, body.provider, credentialId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 201);
    })
    .openapi(readRoute(deps), (c) => {
      const result = signIns.get(callerOf(c.var), c.req.valid('param').signInId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 200);
    })
    .openapi(codeRoute(deps), (c) => {
      const { signInId } = c.req.valid('param');
      const result = signIns.submitCode(callerOf(c.var), signInId, c.req.valid('json').code);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 200);
    })
    .openapi(cancelRoute(deps), (c) => {
      const result = signIns.cancel(callerOf(c.var), c.req.valid('param').signInId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.signIn, 200);
    });
}
