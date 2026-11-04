import { useAuth } from '@clerk/react';
import type { ReactNode } from 'react';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { AcceptInvitationPage } from '../pages/auth/AcceptInvitationPage.tsx';
import { SignInPage, SignUpPage } from '../pages/auth/SignInPage.tsx';
import { CreateCompanyPage } from '../pages/CreateCompanyPage.tsx';
import { LandingPage } from '../pages/LandingPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { CompanyShell } from './CompanyShell.tsx';
import { matchPath, Redirect, useLocation } from './router.tsx';
import { SessionGate } from './session.tsx';

/** The pages behind sign-in, by path. */
function signedInPage(pathname: string): ReactNode {
  if (pathname === '/') return <LandingPage />;
  if (pathname === '/companies/new') return <CreateCompanyPage />;
  const company = matchPath('/c/:slug/*', pathname);
  if (company) return <CompanyShell slug={company.slug ?? ''} section={company['*'] ?? ''} />;
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
 * (the company to open), `/companies/new` and `/c/:slug/...` (a company) behind sign-in.
 */
export function AppRoutes() {
  const { pathname, href } = useLocation();
  if (matchPath('/sign-in/*', pathname)) return <SignInPage />;
  if (matchPath('/sign-up/*', pathname)) return <SignUpPage />;
  if (pathname === '/accept-invitation') return <AcceptInvitationPage />;
  return <SignedIn href={href}>{signedInPage(pathname)}</SignedIn>;
}
