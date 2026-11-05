import type { Logger } from 'pino';
import type { LoginHelper } from '../../../../platform/login-helper/port.ts';
import type { SignInLimits } from '../../rules/sign-in.ts';
import type { CredentialSecrets } from '../secrets.ts';

/** The timers a sign-in sets: its 10-minute limit and the wait for the address or for the end after the code. */
export interface SignInTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Node's timers, unref'd so a sign-in never keeps the process alive. */
export const SYSTEM_SIGN_IN_TIMERS: SignInTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What every sign-in of the server shares: the helper, the store, the logger, the clock, the timers and limits. */
export interface SessionContext {
  readonly helper: LoginHelper;
  readonly secrets: CredentialSecrets;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly timers: SignInTimers;
  readonly limits: SignInLimits;
}

/** Whose sign-in it is, and the request that started it (its audit rows carry it). */
export interface SessionOwner {
  readonly userId: string;
  readonly requestId: string;
}
