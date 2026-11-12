import { owned } from '@mwc/db';
import type { Logger } from 'pino';
import { credentialsRepo } from '../repo.ts';
import {
  renewalRefusal,
  SIGN_IN_ACTIVE,
  SIGN_IN_LIMITS,
  SIGN_IN_NOT_FOUND,
  SIGN_IN_NOT_WAITING,
  SIGN_IN_UNAVAILABLE,
  type SignInLimits,
  type SignInProvider,
  type SignInRefusal,
} from '../rules/sign-in.ts';
import type { SignInView, StartSignIn } from '../schemas/sign-in.ts';
import type { Caller } from '../service.ts';
import { credentialSecrets, type SecretDeps } from './secrets.ts';
import { type SessionContext, type SignInTimers, SYSTEM_SIGN_IN_TIMERS } from './sign-in/context.ts';
import { SIGN_IN_FLOWS } from './sign-in/flows.ts';
import { SignInSession } from './sign-in/session.ts';
import type { SignInTarget } from './sign-in/store.ts';

/** What sign-in needs: the store's deps, the logger, the configured helper (none: 503) and, for tests, its timers. */
export interface SignInDeps extends SecretDeps {
  readonly logger: Logger;
  readonly loginHelper: SessionContext['helper'] | undefined;
  readonly signInTimers?: SignInTimers;
  readonly signInLimits?: Partial<SignInLimits>;
}

type Answer<S extends 404 | 409 | 422 | 503> =
  | { readonly ok: true; readonly signIn: SignInView }
  | SignInRefusal<S>;

/** What every sign-in shares; undefined when signing in is off (MWC_LOGIN_HELPER=none). */
function contextOf(deps: SignInDeps): SessionContext | undefined {
  return (
    deps.loginHelper && {
      helper: deps.loginHelper,
      secrets: credentialSecrets(deps),
      logger: deps.logger,
      clock: deps.clock,
      timers: deps.signInTimers ?? SYSTEM_SIGN_IN_TIMERS,
      limits: { ...SIGN_IN_LIMITS, ...deps.signInLimits },
    }
  );
}

/** The sign-ins of this server process, in memory, by id and by person: at most one active per person. */
function signInSessions(ctx: SessionContext) {
  const sessions = new Map<string, SignInSession>();
  const latest = new Map<string, SignInSession>();
  return {
    /** The caller's sign-in by its id, expired first when its time is up; another person's is none. */
    own(caller: Caller, id: string): SignInSession | undefined {
      const session = sessions.get(id);
      if (session?.owner.userId !== caller.userId) return undefined;
      session.expireIfDue();
      return session;
    },

    /** Ends every sign-in (the server is stopping) and resolves once their sandboxes are killed. */
    async stop(): Promise<void> {
      await Promise.all([...sessions.values()].map((session) => session.stop()));
    },

    /** Opens and begins a sign-in for the caller; undefined while another of theirs is active. */
    open(caller: Caller, provider: SignInProvider, target: SignInTarget): SignInSession | undefined {
      const previous = latest.get(caller.userId);
      previous?.expireIfDue();
      if (previous?.active) return undefined;
      if (previous !== undefined) sessions.delete(previous.id);
      const session = new SignInSession(ctx, caller, SIGN_IN_FLOWS[provider], target);
      sessions.set(session.id, session);
      latest.set(caller.userId, session);
      const line = { signInId: session.id, provider, helper: ctx.helper.mode, renews: 'renew' in target };
      ctx.logger.info(line, 'sign-in started');
      session.begin();
      return session;
    },
  };
}

/**
 * Sign in with Claude and Sign in with OpenAI (S3.2): the sign-ins of this server process, in memory, each bound to
 * the person who started it (another person's is the same 404 as none), at most one active per person, each ending
 * within 10 minutes with its sandbox killed. The finished login is sealed and stored under its owner with
 * `storeCredential`, or, to sign in again, renews their own subscription in place with `renewCredentialLogin`. A server
 * restart forgets the sign-ins in progress: a graceful shutdown (`shutdown`) cancels them and kills their sandboxes.
 */
export function signInService(deps: SignInDeps) {
  const ctx = contextOf(deps);
  const registry = ctx && signInSessions(ctx);
  const found = (session: SignInSession) => ({ ok: true as const, signIn: session.view() });
  const own = (caller: Caller, id: string) => registry?.own(caller, id);
  /** Opens a sign-in for the caller (201 with it `starting`); 409 while another of theirs is active. */
  const open = (caller: Caller, provider: SignInProvider, target: SignInTarget): Answer<409 | 503> => {
    if (registry === undefined) return SIGN_IN_UNAVAILABLE;
    const session = registry.open(caller, provider, target);
    return session === undefined ? SIGN_IN_ACTIVE : found(session);
  };

  return {
    /** Starts a sign-in that adds a new subscription for the caller. */
    start(caller: Caller, body: Omit<StartSignIn, 'credentialId'>): Answer<409 | 503> {
      return open(caller, body.provider, { label: body.label });
    },

    /**
     * Sign in again: starts a sign-in that renews the caller's own subscription `credentialId` in place. 404 when it is
     * not theirs (or no such id), 422 when it is of another kind than the provider's login or revoked.
     */
    async signInAgain(
      caller: Caller,
      provider: SignInProvider,
      credentialId: string,
    ): Promise<Answer<404 | 409 | 422 | 503>> {
      if (registry === undefined) return SIGN_IN_UNAVAILABLE;
      const row = await credentialsRepo().get(owned(deps.db, caller.userId), credentialId);
      return renewalRefusal(provider, row) ?? open(caller, provider, { renew: credentialId });
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

    /** The server is stopping: cancels every sign-in in progress and resolves once their sandboxes are killed. */
    shutdown: async (): Promise<void> => {
      await registry?.stop();
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
