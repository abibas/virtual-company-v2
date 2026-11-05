import { useState } from 'react';
import { Redirect, useLocation } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { shellUser } from '../components/auth/AccountMenu.tsx';
import { AuthSplit } from '../components/auth/AuthSplit.tsx';
import { BrandPanel } from '../components/auth/BrandPanel.tsx';
import { ProfileForm, ProfilePreview } from '../components/auth/ProfileForm.tsx';
import { useProfileDraft } from '../components/auth/profile.ts';
import { Brand } from '../components/layout/Brand.tsx';
import { UserPill } from '../components/layout/TopBar.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Notice } from '../components/ui/Notice.tsx';

/** The step right after Clerk's sign-up: a person without a name is sent here first (`AppRoutes`). */
export const ONBOARDING_PATH = '/onboarding';

/** The onboarding address for a person who was going to `href`, so it can go on there afterwards. */
export function onboardingHref(href: string): string {
  return href === '/' ? ONBOARDING_PATH : `${ONBOARDING_PATH}?redirect_url=${encodeURIComponent(href)}`;
}

/** Where onboarding goes on to: the page of this app the person was going to (never onboarding itself), else `/`. */
function nextPage(search: URLSearchParams): string {
  const to = search.get('redirect_url') ?? '';
  const local = to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/\\');
  return local && !to.startsWith(ONBOARDING_PATH) ? to : '/';
}

const TITLE = 'Your team sees a name, not an email.';
const LINE = 'Your name and photo show in the top bar, on the org chart and in the member list.';

/**
 * `/onboarding`, "Tell us who you are": the first and last name (required) and a photo (optional), saved at the
 * sign-in service and here, in the create-company page's split layout with the person's card as the team will see
 * it. Then on where the person was going: `/` opens their company, or creating one when they have none.
 */
export function OnboardingPage() {
  const { me, reconcile } = useSession();
  const { search } = useLocation();
  const draft = useProfileDraft();
  const [lagging, setLagging] = useState(false);
  if (me.user.displayName !== null) return <Redirect to={nextPage(search)} />;
  const panel = (
    <BrandPanel title={TITLE} line={LINE}>
      <ProfilePreview draft={draft} savedPhoto={me.user.imageUrl} email={me.user.email} />
    </BrandPanel>
  );
  return (
    <AuthSplit
      panel={panel}
      strip={
        <div className="mb-6 w-full max-w-md lg:hidden">
          <Brand plain />
        </div>
      }
      corner={<UserPill user={shellUser(me.user)} compact />}
      footer="You can change your name and photo later, from the menu under your picture."
    >
      <Card padding="lg" className="w-full">
        <h1 className="text-xl font-extrabold tracking-[-0.02em] text-ink">Tell us who you are</h1>
        <p className="mt-1 text-sm text-dim">
          Your first and last name, and a photo if you like: how your teammates see you, instead of your
          email.
        </p>
        <p className="mt-3 min-w-0 truncate text-xs text-dim">
          Signed in as <span className="font-semibold text-ink-2">{me.user.email}</span>
        </p>
        {lagging && (
          <div className="mt-4">
            <Notice tone="warning">
              Your name is saved, but this server has not caught up with the sign-in service yet. Try again in
              a moment.
            </Notice>
          </div>
        )}
        <ProfileForm
          className="mt-6"
          draft={draft}
          savedPhoto={me.user.imageUrl}
          submitLabel="Continue"
          onboarding
          reconcile={reconcile}
          onSaved={(saved) => setLagging(saved.user.displayName === null)}
        />
      </Card>
    </AuthSplit>
  );
}
