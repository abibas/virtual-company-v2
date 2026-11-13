import { Layers, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { profileCalls, useAccessProfiles, useSubscriptions } from '../../api/subscriptions.ts';
import type { Membership } from '../../api/types.ts';
import { navigate, useLocation } from '../../app/router.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { DefaultProfiles } from './DefaultProfiles.tsx';
import { NewProfileForm } from './NewProfile.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import type { TabHeader } from './SubscriptionsTab.tsx';

const SKELETON = <Skeleton className="h-48 rounded-2xl" />;

/** `?new=` (an agent form's Make one) opens New profile once and leaves the address without it, as `?add=1` does. */
function useNewFromAddress(startWith: boolean, open: () => void) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!startWith) return;
    open();
    const rest = new URLSearchParams(search);
    rest.delete('new');
    navigate(rest.size > 0 ? `${pathname}?${rest}` : pathname, { replace: true });
  }, [startWith, open, pathname, search]);
}

/**
 * The Profiles tab (generic profiles since 2026-11-13): the person's profiles as one list of folded rows (one open at a
 * time), each a name with its Claude, OpenAI, GitHub and Atlassian parts and the agents using it, New profile, and their defaults per company, one
 * per AI part. `memberships` and `onDefaultChanged` are the session's (the page passes them); `header` puts New profile
 * in the page's header; `startWith` opens New profile at once (`?new=1`).
 */
export function ProfilesTab({
  memberships,
  onDefaultChanged,
  header,
  startWith = false,
}: {
  readonly memberships: readonly Membership[];
  readonly onDefaultChanged: () => Promise<unknown>;
  readonly header?: TabHeader;
  readonly startWith?: boolean;
}) {
  const api = useApi();
  const calls = useMemo(() => profileCalls(api), [api]);
  const profiles = useAccessProfiles();
  const subscriptions = useSubscriptions();
  const [creating, setCreating] = useState(false);
  // One profile open at a time; opening one folds the one that was open.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useMemo(() => () => setCreating(true), []);
  useNewFromAddress(startWith, open);
  const mine = subscriptions.data?.subscriptions ?? [];
  const action: ReactNode = !creating && (
    <Button size="sm" tone="primary" icon={Plus} onClick={open}>
      New profile
    </Button>
  );
  return (
    <>
      {header ? header(action) : <div className="mb-4 flex justify-end">{action}</div>}
      {creating && (
        <NewProfileForm
          create={(profile) =>
            calls.create(profile).then(() => {
              setCreating(false);
              profiles.reload();
            })
          }
          onCancel={() => setCreating(false)}
        />
      )}
      <LoadState loaded={profiles} label="Loading your profiles…" skeleton={SKELETON}>
        {(data) =>
          data.profiles.length === 0 ? (
            <Card>
              <EmptyState icon={Layers} tone="teal" title="No profiles yet" />
            </Card>
          ) : (
            <div className="grid gap-3">
              {data.profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  open={openId === profile.id}
                  onToggle={() => setOpenId((was) => (was === profile.id ? null : profile.id))}
                  subscriptions={mine}
                  update={(changes) => calls.update(profile.id, changes).then(profiles.reload)}
                  remove={() => calls.remove(profile.id).then(profiles.reload)}
                />
              ))}
            </div>
          )
        }
      </LoadState>
      <DefaultProfiles
        memberships={memberships}
        profiles={profiles.data?.profiles}
        calls={calls}
        onChanged={onDefaultChanged}
      />
    </>
  );
}
