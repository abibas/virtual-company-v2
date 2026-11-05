import type { PastedCredentialKind } from '@mwc/shared/credentials';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage, isApiError } from '../../api/errors.ts';
import { type SubscriptionCalls, subscriptionCalls } from '../../api/subscriptions.ts';
import type { SignIn, SignInProvider } from '../../api/types.ts';

/** The server's sign-in is polled this often while it runs (docs/subscriptions.md). */
const POLL_MS = 2000;

const ACTIVE: ReadonlySet<SignIn['state']> = new Set([
  'starting',
  'waiting_for_user',
  'waiting_for_code',
  'completing',
]);

/** True while the sign-in runs: its sandbox is up and Cancel ends it. */
export const isActive = (signIn: SignIn): boolean => ACTIVE.has(signIn.state);

/** Where Sign in with Claude or OpenAI stands in the page. */
export type SignInPhase =
  | { readonly kind: 'idle' }
  /** `POST .../sign-in` is on its way. */
  | { readonly kind: 'requesting'; readonly provider: SignInProvider }
  /** The server refused to start one (503 off on this server, 409 one already open). */
  | { readonly kind: 'refused'; readonly provider: SignInProvider; readonly message: string }
  /** The sign-in as the last poll saw it; `email` is the new subscription's account, once looked up. */
  | { readonly kind: 'live'; readonly signIn: SignIn; readonly email: string | null | undefined };

export interface SignInControl {
  readonly phase: SignInPhase;
  /** The pasted code (Claude) on its way, and its refusal. */
  readonly code: { readonly sending: boolean; readonly error: string | undefined };
  /** Starts a sign-in: only on the person's click. With `credentialId` (Sign in again), it renews that subscription. */
  start(provider: SignInProvider, credentialId?: string): void;
  sendCode(code: string): void;
  /** Cancels the sign-in in progress (`DELETE`) and forgets it; a late answer is dropped (and cancelled). */
  stop(): void;
}

const NO_CODE = { sending: false, error: undefined } as const;

/** Takes a poll's answer, unless a later start or stop made it stale. */
type Follow = (signIn: SignIn, generation: number) => void;

/**
 * Polls a running sign-in every 2 seconds. Each answer is a new object, which schedules the next poll; a blip polls
 * again, and a sign-in the server no longer knows (it restarted) ends as failed.
 */
function usePoll(signIn: SignIn | undefined, calls: SubscriptionCalls, follow: Follow, generation: number) {
  useEffect(() => {
    if (!signIn || !isActive(signIn)) return;
    const timer = setTimeout(() => {
      calls.signIn(signIn.id).then(
        (next) => follow(next, generation),
        (error: unknown) =>
          isApiError(error, 'sign_in_not_found')
            ? follow({ ...signIn, state: 'failed', message: friendlyMessage(error) }, generation)
            : follow({ ...signIn }, generation),
      );
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [signIn, calls, follow, generation]);
}

/** Once a sign-in is done: tells the page, and looks up the new subscription's account for "Signed in as". */
function useDone(
  credentialId: string | null,
  calls: SubscriptionCalls,
  onDone: () => void,
  onEmail: (email: string | null) => void,
) {
  const tell = useRef({ onDone, onEmail });
  tell.current = { onDone, onEmail };
  useEffect(() => {
    if (!credentialId) return;
    let current = true;
    tell.current.onDone();
    calls.list().then(
      ({ subscriptions }) => {
        if (current)
          tell.current.onEmail(subscriptions.find((s) => s.id === credentialId)?.accountEmail ?? null);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [credentialId, calls]);
}

/** Claude's pasted code, sent to the sign-in followed now, with its progress and refusal. */
function useCode(
  calls: SubscriptionCalls,
  live: RefObject<SignIn | undefined>,
  generation: RefObject<number>,
  follow: Follow,
) {
  const [code, setCode] = useState<SignInControl['code']>(NO_CODE);
  const send = (value: string) => {
    const current = live.current;
    if (!current) return;
    const gen = generation.current;
    setCode({ sending: true, error: undefined });
    calls.sendCode(current.id, value.trim()).then(
      (next) => {
        setCode(NO_CODE);
        follow(next, gen);
      },
      (error: unknown) => setCode({ sending: false, error: friendlyMessage(error) }),
    );
  };
  return { code, send, reset: () => setCode(NO_CODE) };
}

/**
 * Sign in with Claude or OpenAI, live: starts the server's sign-in, polls it while it runs, sends Claude's pasted
 * code, and cancels it on Stop or when the page goes away. `onDone` hears of the new subscription.
 */
export function useSignIn(onDone: () => void): SignInControl {
  const api = useApi();
  const calls = useMemo(() => subscriptionCalls(api), [api]);
  const [phase, setPhase] = useState<SignInPhase>({ kind: 'idle' });
  /** Bumped by every start and stop, so the answers of an earlier sign-in are dropped. */
  const generation = useRef(0);
  /** The sign-in followed now, for Stop and for leaving the page. */
  const live = useRef<SignIn | undefined>(undefined);

  const follow = useCallback<Follow>((signIn, gen) => {
    if (gen !== generation.current) return;
    live.current = signIn;
    setPhase((p) => ({ kind: 'live', signIn, email: p.kind === 'live' ? p.email : undefined }));
  }, []);

  const code = useCode(calls, live, generation, follow);
  const signIn = phase.kind === 'live' ? phase.signIn : undefined;
  usePoll(signIn, calls, follow, generation.current);
  useDone(signIn?.state === 'done' ? signIn.credentialId : null, calls, onDone, (email) =>
    setPhase((p) => (p.kind === 'live' ? { ...p, email } : p)),
  );

  const cancelLive = useCallback(() => {
    generation.current += 1;
    const current = live.current;
    live.current = undefined;
    if (current && isActive(current)) void calls.cancelSignIn(current.id).catch(() => undefined);
  }, [calls]);
  useEffect(() => cancelLive, [cancelLive]);

  const start = (provider: SignInProvider, credentialId?: string) => {
    cancelLive();
    const gen = generation.current;
    code.reset();
    setPhase({ kind: 'requesting', provider });
    calls.startSignIn(provider, credentialId).then(
      (started) =>
        gen === generation.current
          ? follow(started, gen)
          : void calls.cancelSignIn(started.id).catch(() => undefined),
      (error: unknown) => {
        if (gen === generation.current)
          setPhase({ kind: 'refused', provider, message: friendlyMessage(error) });
      },
    );
  };
  const stop = () => {
    cancelLive();
    setPhase({ kind: 'idle' });
  };
  return { phase, code: phase.kind === 'live' ? code.code : NO_CODE, start, sendCode: code.send, stop };
}

/** Where the add sheet is: its choices, a sign-in, or a paste form. */
export type AddStep =
  | { readonly kind: 'choose' }
  /** `credentialId`: Sign in again on that subscription, renewed in place. */
  | { readonly kind: 'sign-in'; readonly provider: SignInProvider; readonly credentialId?: string }
  | { readonly kind: 'paste'; readonly paste: PastedCredentialKind };

export interface AddSubscription {
  readonly open: boolean;
  readonly step: AddStep;
  readonly signIn: SignInControl;
  /** Opens the sheet at its choices. */
  choose(): void;
  /**
   * Opens the sheet on a sign-in (or moves it there) and starts it: the person's click is the request. With
   * `credentialId` (a card's Sign in again), it renews that subscription instead of adding one.
   */
  signInWith(provider: SignInProvider, credentialId?: string): void;
  paste(kind: PastedCredentialKind): void;
  /** Back to the choices; a sign-in in progress is cancelled. */
  back(): void;
  /** Closes the sheet; a sign-in in progress is cancelled. */
  close(): void;
}

/**
 * The add sheet's state, held by the page that shows it (the Subscriptions page, the home widget), so a card's Sign
 * in again and the sheet's own choices start the same sign-in. `onSignedIn` hears of a sign-in's new subscription.
 */
export function useAddSubscription(onSignedIn: () => void): AddSubscription {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AddStep>({ kind: 'choose' });
  const signIn = useSignIn(onSignedIn);
  return {
    open,
    step,
    signIn,
    choose: () => {
      setStep({ kind: 'choose' });
      setOpen(true);
    },
    signInWith: (provider, credentialId) => {
      setStep(
        credentialId === undefined
          ? { kind: 'sign-in', provider }
          : { kind: 'sign-in', provider, credentialId },
      );
      setOpen(true);
      signIn.start(provider, credentialId);
    },
    paste: (kind) => setStep({ kind: 'paste', paste: kind }),
    back: () => {
      signIn.stop();
      setStep({ kind: 'choose' });
    },
    close: () => {
      signIn.stop();
      setOpen(false);
    },
  };
}
