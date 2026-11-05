/**
 * The sign-in service tests' world: a test database with two linked people, and per test a fresh `signInService` on
 * a `FakeLoginHelper` and hand-fired timers, with helpers that start, read and finish sign-ins as one of them.
 */
import { credentialSecrets } from '../../../src/modules/credentials/index.ts';
import type { SignInView } from '../../../src/modules/credentials/schemas/sign-in.ts';
import { type SignInService, signInService } from '../../../src/modules/credentials/service/sign-in.ts';
import { ephemeralKeyring } from '../../../src/platform/secrets/keyring.ts';
import { type AuthWorld, authWorld } from '../auth.ts';
import { addUser, type LinkedUser } from '../companies.ts';
import { FakeLoginHelper, ManualTimers, until } from './helper.ts';

export interface SignInWorld {
  readonly w: AuthWorld;
  readonly ihor: LinkedUser;
  readonly other: LinkedUser;
  helper: FakeLoginHelper;
  timers: ManualTimers;
  signIns: SignInService;
  /** A fresh helper, timers and service (call it in `beforeEach`). */
  reset(): void;
}

const keyring = ephemeralKeyring();

export async function signInWorld(): Promise<SignInWorld> {
  const w = await authWorld({ keyring });
  const world = {
    w,
    ihor: await addUser(w.t.db, w.fake),
    other: await addUser(w.t.db, w.fake),
    reset() {
      world.helper = new FakeLoginHelper();
      world.timers = new ManualTimers();
      world.signIns = signInService({
        db: w.t.db,
        keyring,
        clock: w.clock,
        logger: w.t.logger,
        loginHelper: world.helper,
        signInTimers: world.timers,
      });
    },
  } as SignInWorld;
  world.reset();
  return world;
}

/** The caller a service call acts as. */
export const as = (user: LinkedUser, requestId = 'req-sign-in') => ({ userId: user.userId, requestId });

/** The sign-in of an answer that must not be a refusal. */
export function signInOf(
  answer: { readonly ok: true; readonly signIn: SignInView } | { readonly ok: false },
): SignInView {
  if (!answer.ok) throw new Error(`refused: ${JSON.stringify(answer)}`);
  return answer.signIn;
}

/** Waits until the sign-in is in `state`. */
export const untilState = (s: SignInWorld, id: string, state: SignInView['state'], user = s.ihor) =>
  until(() => signInOf(s.signIns.get(as(user), id)).state === state, state);

/** Opens the stored subscription as its owner, as a usage check would. */
export const openStored = (s: SignInWorld, credentialId: string, user = s.ihor) =>
  credentialSecrets({ db: s.w.t.db, keyring, clock: s.w.clock }).useCredentialSecret(
    credentialId,
    user.userId,
    'test',
  );
