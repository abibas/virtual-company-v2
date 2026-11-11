import { Gauge, Info, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { useSubscriptionLimits } from '../../api/subscriptions.ts';
import type { LimitsList, SubscriptionLimits } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { usePersonalHref } from '../../app/company.ts';
import { cx } from '../../components/cx.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';
import { AddSubscriptionSheet, useAddSubscription } from './AddSubscriptionSheet.tsx';
import { accountLine, hasLimits } from './KindBadge.tsx';
import { LimitMeters } from './LimitMeters.tsx';
import { sourceText, useNow } from './limits.ts';

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

/** The cards of the subscriptions with plan limits, two across from md; the invitation to add one when there is none. */
function LimitsGrid({
  limits,
  now,
  onAdd,
}: {
  readonly limits: readonly SubscriptionLimits[];
  readonly now: number;
  readonly onAdd: () => void;
}) {
  // Keys and gateways have no plan limits: they are not listed here (Ihor: no line about them).
  const plans = limits.filter((item) => hasLimits(item.kind));
  if (plans.length === 0) {
    return (
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
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {plans.map((item) => (
        <LimitCard key={item.credentialId} limits={item} now={now} />
      ))}
    </div>
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
  const manageHref = usePersonalHref('subscriptions');
  return (
    <>
      <LimitsWidget
        limits={limits}
        refreshing={limits.refreshing}
        onRefresh={limits.refresh}
        manageHref={manageHref}
        onAdd={adding.choose}
        now={now}
      />
      <AddSubscriptionSheet adding={adding} onAdded={limits.reload} />
    </>
  );
}
