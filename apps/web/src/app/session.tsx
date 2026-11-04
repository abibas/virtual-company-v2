import { SignOutButton } from '@clerk/react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/context.ts';
import { ApiError, call, friendlyMessage, isApiError } from '../api/errors.ts';
import type { Me, Membership } from '../api/types.ts';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { Brand } from '../components/layout/Brand.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { Button } from '../components/ui/Button.tsx';
import { navigate } from './router.tsx';

export interface Session {
  /** `GET /api/me`: the person, their companies and their session. */
  readonly me: Me;
  /** Reads `GET /api/me` again (after a change to the person's companies) and returns it. */
  reload(): Promise<Me>;
  /**
   * Asks the server to reconcile the person with the sign-in service now (`POST /api/me/reconcile`, once per 10 s),
   * for an invitation accepted while signed in, and returns the answer, which is what `GET /api/me` would say.
   */
  reconcile(): Promise<Me>;
}

const SessionContext = createContext<Session | null>(null);

/** The signed-in person; only inside `<SessionGate>`. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession() is used outside <SessionGate>');
  return session;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'ready'; readonly me: Me };

/** Where a session that cannot go on stops, in plain words, with what the person can do. */
function SessionProblem({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const pending = isApiError(error, 'session_pending');
  const deactivated = isApiError(error, 'user_deactivated');
  const title = pending
    ? 'Your sign-in has a step left'
    : deactivated
      ? 'This account is deactivated'
      : 'Your account could not be loaded';
  return (
    <CenteredState>
      <Brand />
      <h1 className="mt-8 text-2xl font-extrabold tracking-[-0.025em] text-ink">{title}</h1>
      <p className="mt-3 text-sm text-ink-2">
        {pending
          ? 'Finish the step Clerk asks for, then come back here.'
          : deactivated
            ? 'Ask an administrator of your company to restore it, or sign in with another account.'
            : friendlyMessage(error)}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {pending && (
          <Button tone="primary" onClick={() => navigate('/sign-in')}>
            Finish signing in
          </Button>
        )}
        {!pending && !deactivated && (
          <Button tone="primary" onClick={onRetry}>
            Try again
          </Button>
        )}
        <SignOutButton>
          <Button>Sign out</Button>
        </SignOutButton>
      </div>
    </CenteredState>
  );
}

/** A session Clerk still holds as pending (`GET /api/me` accepts it; every other route refuses it). */
const PENDING = new ApiError(403, 'session_pending', 'The session has a pending task');

/**
 * Loads `GET /api/me` once the person is signed in (the server links them and reconciles their memberships on the
 * first call of a session) and shows its children only with it. Key it by the user id, so another person starts over.
 */
export function SessionGate({ children }: { readonly children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<State>({ status: 'loading' });

  const reload = useCallback(async () => {
    const me = await call(api.api.me.$get());
    setState({ status: 'ready', me });
    return me;
  }, [api]);

  const reconcile = useCallback(async () => {
    const me = await call(api.api.me.reconcile.$post());
    setState({ status: 'ready', me });
    return me;
  }, [api]);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    reload().catch((error: unknown) => setState({ status: 'failed', error }));
  }, [reload]);

  useEffect(load, [load]);

  const session = useMemo(
    () => (state.status === 'ready' ? { me: state.me, reload, reconcile } : null),
    [state, reload, reconcile],
  );
  if (state.status === 'loading') {
    return (
      <CenteredState>
        <LoadingBlock label="Loading your account…" />
      </CenteredState>
    );
  }
  if (state.status === 'failed') return <SessionProblem error={state.error} onRetry={load} />;
  if (session === null || session.me.session.pending) {
    return <SessionProblem error={PENDING} onRetry={load} />;
  }
  return <SessionContext value={session}>{children}</SessionContext>;
}

const LAST_COMPANY = 'mwc.lastCompany';

/** Remembers the company last opened in this browser (its slug only), for the next sign-in. */
export function rememberCompany(slug: string): void {
  try {
    window.localStorage.setItem(LAST_COMPANY, slug);
  } catch {
    // Storage blocked (a private window): the first company is the default then.
  }
}

/** The company to open: the last one opened here when the person is still an active member, else the first one. */
export function chooseCompany(me: Me): Membership | undefined {
  const active = me.memberships.filter((membership) => membership.status === 'active');
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(LAST_COMPANY);
  } catch {
    last = null;
  }
  return active.find((membership) => membership.slug === last) ?? active[0];
}
