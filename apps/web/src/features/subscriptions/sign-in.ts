import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage, isApiError } from '../../api/errors.ts';
import { isTransient, nextOutage, type Outage } from '../../api/retry.ts';
import { type SubscriptionCalls, subscriptionCalls } from '../../api/subscriptions.ts';
import type { SignIn, SignInProvider, Subscription } from '../../api/types.ts';

/** The server's sign-in is polled this often while it runs (docs/subscriptions.md). */
const POLL_MS = 2000;

/** How long polls ride out a server that does not answer (a restart) before the sign-in is given up. */
const POLL_OUTAGE_MS = 20_000;

const INTERRUPTED = 'The sign-in was interrupted (the server restarted). Start again.';
const NO_ANSWER = 'The server did not answer for 20 seconds. Start again once it is back.';

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
  | { readonly kind: 'live'; readonly signIn: SignIn; readonly email: string | null | undefined }
  /** The server no longer knows the sign-in (it restarted): Start again begins a fresh one. */
  | { readonly kind: 'interrupted'; readonly signIn: SignIn };

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

/** Takes a poll's answer, unless a later start or stop made it stale; `interrupted`: the server forgot it. */
type Follow = (signIn: SignIn, generation: number, interrupted?: boolean) => void;

/**
 * Polls a running sign-in every 2 seconds. Each answer is a new object, which schedules the next poll. A server that
 * does not answer (a restart) is polled again sooner, then less often, for up to 20 seconds; another blip polls again;
 * a sign-in the server no longer knows (it restarted) ends as interrupted.
 */
function usePoll(signIn: SignIn | undefined, calls: SubscriptionCalls, follow: Follow, generation: number) {
  const outage = useRef<{ readonly id: string; readonly outage: Outage } | undefined>(undefined);
  useEffect(() => {
    if (!signIn || !isActive(signIn)) return;
    const current = outage.current?.id === signIn.id ? outage.current.outage : undefined;
    const timer = setTimeout(() => {
      calls.signIn(signIn.id).then(
        (next) => {
          outage.current = undefined;
          follow(next, generation);
        },
        (error: unknown) => {
          const next = isTransient(error) ? nextOutage(current, POLL_OUTAGE_MS) : undefined;
          outage.current = next && { id: signIn.id, outage: next };
          if (isApiError(error, 'sign_in_not_found'))
            follow({ ...signIn, state: 'failed', message: INTERRUPTED }, generation, true);
          else if (isTransient(error) && !next)
            follow({ ...signIn, state: 'failed', message: NO_ANSWER }, generation);
          else follow({ ...signIn }, generation);
        },
      );
    }, current?.waitMs ?? POLL_MS);
    return () => clearTimeout(timer);
  }, [signIn, calls, follow, generation]);
}

/** Who a sign-in signed in as: GitHub's login, else its email. */
function accountOf(signedIn: Subscription | undefined): string | null {
  const login = signedIn?.accountMeta.login;
  return typeof login === 'string' ? login : (signedIn?.accountEmail ?? null);
}

/** Once a sign-in is done: tells the page, and looks up the new subscription's account for "Signed in as". */
function useDone(
  credentialId: string | null,
  calls: SubscriptionCalls,
  onDone: (credentialId: string) => void,
  onEmail: (email: string | null) => void,
) {
  const tell = useRef({ onDone, onEmail });
  tell.current = { onDone, onEmail };
  useEffect(() => {
    if (!credentialId) return;
    let current = true;
    tell.current.onDone(credentialId);
    calls.list().then(
      ({ subscriptions }) => {
        if (current) tell.current.onEmail(accountOf(subscriptions.find((s) => s.id === credentialId)));
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
export function useSignIn(onDone: (credentialId: string) => void): SignInControl {
  const api = useApi();
  const calls = useMemo(() => subscriptionCalls(api), [api]);
  const [phase, setPhase] = useState<SignInPhase>({ kind: 'idle' });
  /** Bumped by every start and stop, so the answers of an earlier sign-in are dropped. */
  const generation = useRef(0);
  /** The sign-in followed now, for Stop and for leaving the page. */
  const live = useRef<SignIn | undefined>(undefined);

  const follow = useCallback<Follow>((signIn, gen, interrupted = false) => {
    if (gen !== generation.current) return;
    live.current = signIn;
    setPhase((p) =>
      interrupted
        ? { kind: 'interrupted', signIn }
        : { kind: 'live', signIn, email: p.kind === 'live' ? p.email : undefined },
    );
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

/** A card just added or signed in to, ringed for a few seconds: its id, and how to set it. */
export function useHighlight(): readonly [string | undefined, (id: string | undefined) => void] {
  const [highlight, setHighlight] = useState<string>();
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(undefined), 4000);
    return () => clearTimeout(timer);
  }, [highlight]);
  return [highlight, setHighlight];
}
