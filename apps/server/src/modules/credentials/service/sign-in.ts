import type { Logger } from 'pino';
import {
  SIGN_IN_ACTIVE,
  SIGN_IN_LIMITS,
  SIGN_IN_NOT_FOUND,
  SIGN_IN_NOT_WAITING,
  SIGN_IN_UNAVAILABLE,
  type SignInLimits,
  type SignInRefusal,
} from '../rules/sign-in.ts';
import type { SignInView, StartSignIn } from '../schemas/sign-in.ts';
import type { Caller } from '../service.ts';
import { credentialSecrets, type SecretDeps } from './secrets.ts';
import { type SessionContext, type SignInTimers, SYSTEM_SIGN_IN_TIMERS } from './sign-in/context.ts';
import { SIGN_IN_FLOWS } from './sign-in/flows.ts';
import { SignInSession } from './sign-in/session.ts';

/** What sign-in needs: the store's deps, the logger, the configured helper (none: 503) and, for tests, its timers. */
export interface SignInDeps extends SecretDeps {
  readonly logger: Logger;
  readonly loginHelper: SessionContext['helper'] | undefined;
  readonly signInTimers?: SignInTimers;
  readonly signInLimits?: Partial<SignInLimits>;
}

type Answer<S extends 404 | 409 | 503> =
  | { readonly ok: true; readonly signIn: SignInView }
  | SignInRefusal<S>;

/**
 * Sign in with Claude and Sign in with OpenAI (S3.2): the sign-ins of this server process, in memory, each bound to
 * the person who started it (another person's is the same 404 as none), at most one active per person, each ending
 * within 10 minutes with its sandbox killed. The finished login is sealed and stored under its owner with
 * `storeCredential`. A server restart forgets the sign-ins in progress; their containers end themselves.
 */
export function signInService(deps: SignInDeps) {
  const sessions = new Map<string, SignInSession>();
  const latest = new Map<string, SignInSession>();
  const ctx: SessionContext | undefined = deps.loginHelper && {
    helper: deps.loginHelper,
    secrets: credentialSecrets(deps),
    logger: deps.logger,
    clock: deps.clock,
    timers: deps.signInTimers ?? SYSTEM_SIGN_IN_TIMERS,
    limits: { ...SIGN_IN_LIMITS, ...deps.signInLimits },
  };
  const found = (session: SignInSession) => ({ ok: true as const, signIn: session.view() });
  /** The caller's sign-in by its id, expired first when its time is up. */
  const own = (caller: Caller, id: string) => {
    const session = sessions.get(id);
    if (session?.owner.userId !== caller.userId) return undefined;
    session.expireIfDue();
    return session;
  };

  return {
    /** Starts a sign-in for the caller (201 with it `starting`); 409 while another of theirs is active. */
    start(caller: Caller, body: StartSignIn): Answer<409 | 503> {
      if (ctx === undefined) return SIGN_IN_UNAVAILABLE;
      const previous = latest.get(caller.userId);
      previous?.expireIfDue();
      if (previous?.active) return SIGN_IN_ACTIVE;
      if (previous !== undefined) sessions.delete(previous.id);
      const session = new SignInSession(ctx, caller, SIGN_IN_FLOWS[body.provider], body.label);
      sessions.set(session.id, session);
      latest.set(caller.userId, session);
      const line = { signInId: session.id, provider: body.provider, helper: ctx.helper.mode };
      deps.logger.info(line, 'sign-in started');
      session.begin();
      return found(session);
    },

    get(caller: Caller, id: string): Answer<404> {
      const session = own(caller, id);
      return session === undefined ? SIGN_IN_NOT_FOUND : found(session);
    },

    /** Types the code Anthropic's page showed into Claude's login; 409 when it is not waiting for one. */
    submitCode(caller: Caller, id: string, code: string): Answer<404 | 409> {
      const session = own(caller, id);
      if (session === undefined) return SIGN_IN_NOT_FOUND;
      return session.submitCode(code) ? found(session) : SIGN_IN_NOT_WAITING;
    },

    /** Cancels the caller's sign-in and kills its sandbox; one that has ended stays as it was. */
    cancel(caller: Caller, id: string): Answer<404> {
      const session = own(caller, id);
      if (session === undefined) return SIGN_IN_NOT_FOUND;
      session.cancel();
      return found(session);
    },
  };
}

export type SignInService = ReturnType<typeof signInService>;
