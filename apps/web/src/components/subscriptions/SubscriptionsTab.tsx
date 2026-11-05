import { Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import {
  type SubscriptionCalls,
  subscriptionCalls,
  useSubscriptionLimits,
  useSubscriptions,
} from '../../api/subscriptions.ts';
import type { LimitsList, SignInProvider, Subscription } from '../../api/types.ts';
import { cx } from '../cx.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { AddSubscriptionSheet } from './AddSubscriptionSheet.tsx';
import { useNow } from './limits.ts';
import { SubscriptionCard } from './SubscriptionCard.tsx';
import { useAddSubscription } from './sign-in.ts';

const SKELETON = (
  <div className="grid gap-4 md:grid-cols-2">
    <Skeleton className="h-52 rounded-2xl" />
    <Skeleton className="h-52 rounded-2xl max-md:hidden" />
  </div>
);

/** The tab's bar: what the cards are, a fresh check of the limits, and Add a subscription. */
function TabBar({
  refreshing,
  onRefresh,
  onAdd,
}: {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onAdd: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-prose text-sm text-dim">
        Personal to you, in every company. Secrets are stored encrypted and never shown back.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          tone="quiet"
          icon={RefreshCw}
          disabled={refreshing}
          onClick={onRefresh}
          className={cx(refreshing && 'motion-safe:[&_svg]:animate-spin')}
        >
          Check limits
        </Button>
        <Button size="sm" tone="primary" icon={Plus} onClick={onAdd}>
          Add a subscription
        </Button>
      </div>
    </div>
  );
}

interface ListProps {
  readonly list: readonly Subscription[];
  readonly limits: LimitsList | undefined;
  readonly now: number;
  readonly calls: SubscriptionCalls;
  /** A card renamed or removed one: read the lists again. */
  readonly onChanged: () => void;
  readonly onSignIn: (provider: SignInProvider, credentialId: string) => void;
  readonly onAdd: () => void;
}

/** The cards, two across from md; the invitation to add the first one. */
function SubscriptionList({ list, limits, now, calls, onChanged, onSignIn, onAdd }: ListProps) {
  if (list.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Sparkles}
          tone="blue"
          title="No subscriptions yet"
          action={
            <Button tone="primary" icon={Plus} onClick={onAdd}>
              Add a subscription
            </Button>
          }
        >
          Sign in with Claude or OpenAI once, here. Your agents then run on your subscription, and its limits
          show on your home page.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {list.map((subscription) => (
        <SubscriptionCard
          key={subscription.id}
          subscription={subscription}
          limits={limits?.limits.find((entry) => entry.credentialId === subscription.id)}
          now={now}
          rename={(label) => calls.rename(subscription.id, label).then(onChanged)}
          remove={() => calls.remove(subscription.id).then(onChanged)}
          onSignIn={onSignIn}
        />
      ))}
    </div>
  );
}

/**
 * The Subscriptions tab: one card per subscription with its kind, state, account and limits; rename, remove and Sign
 * in again on each, and Add a subscription in a sheet beside the page.
 */
export function SubscriptionsTab() {
  const api = useApi();
  const calls = useMemo(() => subscriptionCalls(api), [api]);
  const subscriptions = useSubscriptions();
  const limits = useSubscriptionLimits();
  const now = useNow();
  const [added, setAdded] = useState<string>();
  const changed = () => {
    subscriptions.reload();
    limits.reload();
  };
  const adding = useAddSubscription(changed);
  return (
    <>
      <TabBar refreshing={limits.refreshing} onRefresh={limits.refresh} onAdd={adding.choose} />
      {added && (
        <div className="mb-4">
          <Notice tone="success" onDismiss={() => setAdded(undefined)}>
            {added}
          </Notice>
        </div>
      )}
      <LoadState loaded={subscriptions} label="Loading your subscriptions…" skeleton={SKELETON}>
        {(data) => (
          <SubscriptionList
            list={data.subscriptions}
            limits={limits.data}
            now={now}
            calls={calls}
            onChanged={changed}
            onSignIn={adding.signInWith}
            onAdd={adding.choose}
          />
        )}
      </LoadState>
      <AddSubscriptionSheet
        adding={adding}
        onAdded={(subscription) => {
          changed();
          setAdded(`${subscription.label} is added.`);
        }}
      />
    </>
  );
}
