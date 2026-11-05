import { useClerk } from '@clerk/react';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { PlainShell } from '../app/PlainShell.tsx';
import { Link } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { ProfileForm } from '../components/auth/ProfileForm.tsx';
import { useProfileDraft } from '../components/auth/profile.ts';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Notice } from '../components/ui/Notice.tsx';

/**
 * `/profile`, from the account menu: the person's first and last name and photo, changed (or the photo removed) at
 * the sign-in service and taken in here at once. Their email and sign-in methods stay on Clerk's own account page.
 */
export function ProfilePage() {
  const { me, reconcile } = useSession();
  const clerk = useClerk();
  const draft = useProfileDraft();
  const [saved, setSaved] = useState(false);
  return (
    <PlainShell>
      <PageHeader title="Your profile">
        <p>Your name and photo, as your teammates see them in every company you belong to.</p>
      </PageHeader>
      {saved && (
        <div className="mb-5">
          <Notice tone="success" onDismiss={() => setSaved(false)}>
            Saved. Your name and photo show everywhere now.
          </Notice>
        </div>
      )}
      <ProfileForm
        draft={draft}
        savedPhoto={me.user.imageUrl}
        removable
        submitLabel="Save changes"
        reconcile={reconcile}
        onSaved={() => setSaved(true)}
        cancel={
          <Link to="/" className="text-sm font-semibold text-dim hover:text-ink">
            Back to your company
          </Link>
        }
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="min-w-0 text-sm text-dim">
          Email, sign-in methods and sessions: <span className="break-all text-ink-2">{me.user.email}</span>
        </p>
        <Button size="sm" icon={Settings} onClick={() => clerk.openUserProfile()}>
          Manage account
        </Button>
      </div>
    </PlainShell>
  );
}
