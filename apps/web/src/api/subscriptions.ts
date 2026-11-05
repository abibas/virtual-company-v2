import { useCallback, useRef, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import type {
  AccessProfile,
  AccessProfileChanges,
  LimitsList,
  NewAccessProfile,
  NewSubscription,
  SignInProvider,
  Subscription,
} from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The signed-in person's own subscriptions, sign-ins, limits and access profiles (`/api/me/...`). Personal, never a
 * company's, and managed only with a Clerk session (an API key is refused). Answers carry metadata, never a secret.
 */

/** The person's subscriptions, oldest first. */
export function useSubscriptions(): Loaded<{ readonly subscriptions: readonly Subscription[] }> {
  const api = useApi();
  return useLoad('subscriptions', () => call(api.api.me.subscriptions.$get()));
}

export interface LiveLimits extends Loaded<LimitsList> {
  /** A refresh the person asked for is on its way. */
  readonly refreshing: boolean;
  /** Asks the providers again (`?refresh=1`, past the server's 5-minute floor): on the person's click only. */
  refresh(): void;
}

/** The limits of the person's subscriptions: the server's cached answer on load, a fresh check on request. */
export function useSubscriptionLimits(): LiveLimits {
  const api = useApi();
  const wanted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useLoad('subscription-limits', async () => {
    const refresh = wanted.current;
    wanted.current = false;
    try {
      return await call(api.api.me.subscriptions.limits.$get({ query: refresh ? { refresh: '1' } : {} }));
    } finally {
      if (refresh) setRefreshing(false);
    }
  });
  const { reload } = loaded;
  const refresh = useCallback(() => {
    wanted.current = true;
    setRefreshing(true);
    reload();
  }, [reload]);
  return { ...loaded, refreshing, refresh };
}

/** The person's access profiles, each with its slots' subscriptions and the agents that use it. */
export function useAccessProfiles(): Loaded<{ readonly profiles: readonly AccessProfile[] }> {
  const api = useApi();
  return useLoad('access-profiles', () => call(api.api.me['access-profiles'].$get()));
}

/** The person's changes to their subscriptions: add a pasted one, rename, remove, and the two sign-ins. */
export function subscriptionCalls(api: Api) {
  const subscriptions = api.api.me.subscriptions;
  const one = subscriptions[':credentialId'];
  const signIn = subscriptions['sign-in'];
  return {
    list: () => call(subscriptions.$get()),
    add: (subscription: NewSubscription) => call(subscriptions.$post({ json: subscription })),
    rename: (credentialId: string, label: string) =>
      call(one.$patch({ param: { credentialId }, json: { label } })),
    remove: (credentialId: string) => call(one.$delete({ param: { credentialId } })),
    /** Starts a sign-in; with `credentialId` (Sign in again), it renews that subscription in place. */
    startSignIn: (provider: SignInProvider, credentialId?: string) =>
      call(signIn.$post({ json: credentialId === undefined ? { provider } : { provider, credentialId } })),
    signIn: (signInId: string) => call(signIn[':signInId'].$get({ param: { signInId } })),
    sendCode: (signInId: string, code: string) =>
      call(signIn[':signInId'].code.$post({ param: { signInId }, json: { code } })),
    cancelSignIn: (signInId: string) => call(signIn[':signInId'].$delete({ param: { signInId } })),
  };
}

export type SubscriptionCalls = ReturnType<typeof subscriptionCalls>;

/** The person's changes to their access profiles, and their default one in a company. */
export function profileCalls(api: Api) {
  const profiles = api.api.me['access-profiles'];
  return {
    create: (profile: NewAccessProfile) => call(profiles.$post({ json: profile })),
    update: (profileId: string, changes: AccessProfileChanges) =>
      call(profiles[':profileId'].$patch({ param: { profileId }, json: changes })),
    remove: (profileId: string) => call(profiles[':profileId'].$delete({ param: { profileId } })),
    setDefault: (companyId: string, profileId: string | null) =>
      call(
        api.api.companies[':companyId'].me['default-profile'].$put({
          param: { companyId },
          json: { profileId },
        }),
      ),
  };
}

export type ProfileCalls = ReturnType<typeof profileCalls>;
