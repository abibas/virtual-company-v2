import { SignIn, SignUp, useAuth, useUser } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import type { Membership } from '../../api/types.ts';
import { PlainShell } from '../../app/PlainShell.tsx';
import { Link, navigate, Redirect, useLocation } from '../../app/router.tsx';
import { SessionGate, useSession } from '../../app/session.tsx';
import { AuthLayout } from '../../components/AuthLayout.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { CenteredState, LoadingBlock } from '../../components/ui/Loading.tsx';
import { PageHeader } from '../../components/ui/PageHeader.tsx';

/** Where Clerk sends the person once the invitation's sign-up or sign-in is done: this page, signed in. */
const HERE = '/accept-invitation';
/** How often the waiting screen asks again for a membership the server has not projected yet. */
const RECHECK_MS = 10_000;

/** The organization of the person's newest Clerk membership: the invitation they have just accepted. */
function useNewestOrganization(): string | undefined {
  const { user } = useUser();
  const newest = [...(user?.organizationMemberships ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  return newest?.organization.id;
}

/**
 * Signed in after accepting: opens the invited company once the server lists it. The first `GET /api/me` of a new
 * session reconciles; a person who was signed in already gets one `POST /api/me/reconcile`, so they need not wait.
 */
function JoinInvitedCompany() {
  const { me, reload, reconcile } = useSession();
  const organization = useNewestOrganization();
  const invited: Membership | undefined = me.memberships.find(
    (m) => m.status === 'active' && m.identityOrgId !== null && m.identityOrgId === organization,
  );
  const waiting = invited === undefined && organization !== undefined;
  const reconciled = useRef(false);

  useEffect(() => {
    if (invited) navigate(`/c/${invited.slug}`, { replace: true });
    else if (organization === undefined) navigate('/', { replace: true });
  }, [invited, organization]);
  useEffect(() => {
    if (!waiting || reconciled.current) return;
    reconciled.current = true;
    void reconcile().catch(() => undefined);
  }, [waiting, reconcile]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload().catch(() => undefined), RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  if (!waiting) {
    return (
      <CenteredState>
        <LoadingBlock label={invited ? `Opening ${invited.name}…` : 'Opening your companies…'} />
      </CenteredState>
    );
  }
  return (
    <PlainShell>
      <PageHeader title="Your invitation is accepted">
        <p>
          The company shows up here as soon as this server has caught up with the sign-in service: within
          about ten minutes, or right away when an admin of the company selects Sync now on its Members page.
          This page checks again by itself.
        </p>
      </PageHeader>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" onClick={() => void reload().catch(() => undefined)}>
          Check again
        </Button>
        <Link
          to="/"
          className="inline-flex min-h-9 items-center rounded-sm border border-line-2 px-3.5 text-[13.5px] text-ink-2 hover:bg-panel-2"
        >
          Go to my companies
        </Link>
      </div>
    </PlainShell>
  );
}

/**
 * `/accept-invitation`, where the invitation email's link lands (`__clerk_ticket`, `__clerk_status`): Clerk's sign-up
 * (or sign-in, for an existing account) takes the ticket, then the person lands in the company that invited them.
 */
export function AcceptInvitationPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { search } = useLocation();
  // Read once: Clerk's own steps may change the address while the person signs up.
  const [invitation] = useState(() => ({
    status: search.get('__clerk_status'),
    ticket: search.has('__clerk_ticket'),
  }));

  if (!isLoaded) {
    return (
      <CenteredState>
        <LoadingBlock label="Opening your invitation…" />
      </CenteredState>
    );
  }
  if (isSignedIn) {
    return (
      <SessionGate key={userId}>
        <JoinInvitedCompany />
      </SessionGate>
    );
  }
  if (invitation.status === 'complete')
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(HERE)}`} />;
  if (!invitation.ticket) {
    return (
      <AuthLayout>
        <div className="w-full max-w-md">
          <PageHeader title="This invitation link is incomplete">
            <p>
              Open the link in the invitation email again, or ask the person who invited you to resend it.
            </p>
          </PageHeader>
          <Link to="/sign-in" className="text-amber underline underline-offset-4">
            Sign in instead
          </Link>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout footer="You were invited to a company. Finish here and you land in it.">
      {invitation.status === 'sign_in' ? (
        <SignIn routing="hash" forceRedirectUrl={HERE} signUpUrl="/sign-up" />
      ) : (
        <SignUp
          routing="hash"
          forceRedirectUrl={HERE}
          signInUrl={`/sign-in?redirect_url=${encodeURIComponent(HERE)}`}
        />
      )}
    </AuthLayout>
  );
}
