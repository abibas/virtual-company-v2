import { useAuth } from '@clerk/react';
import { isReservedSlug } from '@mwc/shared/slugs';
import type { ReactNode } from 'react';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { AcceptInvitationPage } from '../pages/auth/AcceptInvitationPage.tsx';
import { SignInPage, SignUpPage } from '../pages/auth/SignInPage.tsx';
import { CreateCompanyPage } from '../pages/CreateCompanyPage.tsx';
import { LandingPage } from '../pages/LandingPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { OnboardingPage, onboardingHref } from '../pages/OnboardingPage.tsx';
import { ProfilePage } from '../pages/ProfilePage.tsx';
import { SubscriptionsPage } from '../pages/SubscriptionsPage.tsx';
import { CompanyShell } from './CompanyShell.tsx';
import { withoutOldPrefix } from './nav.ts';
import { matchPath, Redirect, useLocation } from './router.tsx';
import { SessionGate, useSession } from './session.tsx';

/**
 * A person who has not given their name yet (right after Clerk's sign-up, or an invitee's) goes to onboarding first,
 * then on to where they were going; every other page waits for it.
 */
function NamedOnly({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const { me } = useSession();
  if (me.user.displayName === null) return <Redirect to={onboardingHref(href)} />;
  return children;
}

/**
 * The pages behind sign-in, by path; any other first segment is a company's address, unless the app keeps it for its
 * own pages (`RESERVED_SLUGS`, which every first segment here must be in: the server's web test checks it).
 */
function signedInPage(pathname: string): ReactNode {
  if (pathname === '/') return <LandingPage />;
  if (pathname === '/profile') return <ProfilePage />;
  if (pathname === '/subscriptions') return <SubscriptionsPage />;
  if (pathname === '/companies/new') return <CreateCompanyPage />;
  const company = matchPath('/:slug/*', pathname);
  if (company?.slug && !isReservedSlug(company.slug)) {
    return <CompanyShell slug={company.slug} section={company['*'] ?? ''} />;
  }
  return <NotFoundPage />;
}

/** Signed in: the page with the person's account loaded; signed out: the sign-in page, back here afterwards. */
function SignedIn({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) {
    return (
      <CenteredState>
        <LoadingBlock label="Checking your sign-in…" />
      </CenteredState>
    );
  }
  if (!isSignedIn) {
    return <Redirect to={href === '/' ? '/sign-in' : `/sign-in?redirect_url=${encodeURIComponent(href)}`} />;
  }
  return <SessionGate key={userId}>{children}</SessionGate>;
}

/**
 * The routes: `/sign-in`, `/sign-up` (Clerk's own steps below them) and `/accept-invitation` for everyone; `/`
 * (the company to open), `/companies/new`, `/profile`, `/subscriptions` (the old address of the person's own pages,
 * now company pages: it opens the last company's) and `/:slug/...` (a company) behind
 * sign-in, each once the person has a name: until then `/onboarding` asks for it. An old company link,
 * `/c/<slug>/...`, is replaced by the same address without `/c`.
 */
export function AppRoutes() {
  const { pathname, href } = useLocation();
  if (matchPath('/c/*', pathname)) return <Redirect to={withoutOldPrefix(href)} />;
  if (matchPath('/sign-in/*', pathname)) return <SignInPage />;
  if (matchPath('/sign-up/*', pathname)) return <SignUpPage />;
  if (pathname === '/accept-invitation') return <AcceptInvitationPage />;
  if (pathname === '/onboarding') {
    return (
      <SignedIn href={href}>
        <OnboardingPage />
      </SignedIn>
    );
  }
  return (
    <SignedIn href={href}>
      <NamedOnly href={href}>{signedInPage(pathname)}</NamedOnly>
    </SignedIn>
  );
}
