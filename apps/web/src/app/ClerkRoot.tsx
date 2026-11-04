import { ClerkProvider, useAuth } from '@clerk/react';
import { type ReactNode, useMemo, useRef } from 'react';
import { createApi } from '../api/client.ts';
import { ApiContext } from '../api/context.ts';
import { AppRoutes } from './AppRoutes.tsx';
import { useClerkAppearance } from './appearance.ts';
import { navigate } from './router.tsx';

/** The API client that sends the signed-in person's session token (a fresh one from Clerk for every call). */
function SignedInApi({ children }: { readonly children: ReactNode }) {
  const { getToken } = useAuth();
  const tokens = useRef(getToken);
  tokens.current = getToken;
  const api = useMemo(() => createApi(() => tokens.current()), []);
  return <ApiContext value={api}>{children}</ApiContext>;
}

/**
 * The app with Clerk signing people in: the publishable key from `GET /api/config` (read at boot, never built in),
 * telemetry off, Clerk's navigation through the app's router, and the sign-in and sign-up pages of this app.
 */
export function ClerkRoot({ publishableKey }: { readonly publishableKey: string }) {
  const appearance = useClerkAppearance();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      telemetry={false}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
      appearance={appearance}
    >
      <SignedInApi>
        <AppRoutes />
      </SignedInApi>
    </ClerkProvider>
  );
}
