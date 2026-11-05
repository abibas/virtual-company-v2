import { Gauge, Info, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { useSubscriptionLimits } from '../../api/subscriptions.ts';
import type { LimitsList, SubscriptionLimits } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { SUBSCRIPTIONS_PATH } from '../auth/AccountMenu.tsx';
import { cx } from '../cx.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Button, ButtonLink } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import { AddSubscriptionSheet } from './AddSubscriptionSheet.tsx';
import { accountLine, hasLimits } from './KindBadge.tsx';
import { LimitMeters } from './LimitMeters.tsx';
import { sourceText, useNow } from './limits.ts';
import { useAddSubscription } from './sign-in.ts';

/** One subscription's card: its name and account, where the numbers come from (the info mark), and its bars. */
export function LimitCard({ limits, now }: { readonly limits: SubscriptionLimits; readonly now: number }) {
  const account = accountLine({ label: limits.label, accountEmail: limits.accountEmail, accountMeta: {} });
  const source = sourceText(limits, now);
  return (
    <Card as="article" variant="soft" padding="sm" aria-label={limits.label} className="flex flex-col gap-4">
      <header className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-bold text-ink">{limits.label}</span>
          {account && <span className="text-dim"> · {account}</span>}
        </p>
        <Tooltip label={source} side="bottom-end" wrap>
          <IconButton label={source} icon={Info} size="sm" className="-my-1.5 -mr-1.5" />
        </Tooltip>
      </header>
      <LimitMeters limits={limits} now={now} />
    </Card>
  );
}

/** Keys and gateways: one quiet line, since the provider sets them no plan limits. */
function PayAsYouGo({ items }: { readonly items: readonly SubscriptionLimits[] }) {
  return (
    <p className="mt-3 text-xs text-dim">
      <span className="font-semibold text-ink-2">{items.map((item) => item.label).join(', ')}</span>
      {items.length === 1 ? ' has' : ' have'} no limits (pay as you go).
    </p>
  );
}

/** The cards, two across from md, then the pay-as-you-go line; the invitation to add one when there is none. */
function LimitsGrid({
  limits,
  now,
  onAdd,
}: {
  readonly limits: readonly SubscriptionLimits[];
  readonly now: number;
  readonly onAdd: () => void;
}) {
  const plans = limits.filter((item) => hasLimits(item.kind));
  const payg = limits.filter((item) => !hasLimits(item.kind));
  if (plans.length === 0) {
    return (
      <>
        <EmptyState
          icon={Gauge}
          tone="blue"
          size="sm"
          title="No subscription limits yet"
          action={
            <Button tone="primary" icon={Plus} onClick={onAdd}>
              Add a subscription
            </Button>
          }
        >
          Add your Claude or OpenAI subscription to see its limits here.
        </EmptyState>
        {payg.length > 0 && <PayAsYouGo items={payg} />}
      </>
    );
  }
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((item) => (
          <LimitCard key={item.credentialId} limits={item} now={now} />
        ))}
      </div>
      {payg.length > 0 && <PayAsYouGo items={payg} />}
    </>
  );
}

const SKELETON = (
  <div className="grid gap-3 md:grid-cols-2">
    <Skeleton className="h-36 rounded-2xl" />
    <Skeleton className="h-36 rounded-2xl max-md:hidden" />
  </div>
);

export interface LimitsWidgetProps {
  readonly limits: Loaded<LimitsList>;
  /** A refresh the person asked for is on its way. */
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  /** The Subscriptions page. */
  readonly manageHref: string;
  /** Opens the add sheet in place. */
  readonly onAdd: () => void;
  /** The time the "resets in" lines count from. */
  readonly now: number;
}

/** "Subscription limits": the person's own subscriptions with their live 5-hour and weekly bars, across companies. */
export function LimitsWidget({ limits, refreshing, onRefresh, manageHref, onAdd, now }: LimitsWidgetProps) {
  return (
    <Panel
      title="Subscription limits"
      description="Your own subscriptions, in every company you work in."
      actions={
        <>
          <IconButton
            label="Check the limits again"
            icon={RefreshCw}
            size="sm"
            tooltip="bottom"
            disabled={refreshing || limits.data === undefined}
            onClick={onRefresh}
            className={cx(refreshing && 'motion-safe:[&_svg]:animate-spin')}
          />
          <ButtonLink href={manageHref} size="sm" tone="quiet" icon={Settings2}>
            Manage
          </ButtonLink>
          <Button size="sm" tone="soft" icon={Plus} onClick={onAdd}>
            Add a subscription
          </Button>
        </>
      }
    >
      <LoadState loaded={limits} label="Loading your subscription limits…" skeleton={SKELETON}>
        {(data) => <LimitsGrid limits={data.limits} now={now} onAdd={onAdd} />}
      </LoadState>
    </Panel>
  );
}

/** The widget on the home page, live: the limits on load, a refresh on request, and the add sheet in place. */
export function SubscriptionLimitsWidget() {
  const limits = useSubscriptionLimits();
  const adding = useAddSubscription(limits.reload);
  const now = useNow();
  return (
    <>
      <LimitsWidget
        limits={limits}
        refreshing={limits.refreshing}
        onRefresh={limits.refresh}
        manageHref={SUBSCRIPTIONS_PATH}
        onAdd={adding.choose}
        now={now}
      />
      <AddSubscriptionSheet adding={adding} onAdded={limits.reload} />
    </>
  );
}
