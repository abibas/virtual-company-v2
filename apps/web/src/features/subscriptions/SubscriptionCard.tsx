import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { LogIn } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { SignInProvider, Subscription, SubscriptionLimits } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { formatDate, formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { accountLine, hasLimits, KindBadge, signInOf } from './KindBadge.tsx';
import { LimitMeters } from './LimitMeters.tsx';

interface SubscriptionCardProps {
  readonly subscription: Subscription;
  /** Its entry of `GET .../limits`; undefined while they load. */
  readonly limits: SubscriptionLimits | undefined;
  readonly now: number;
  /** Renames it (`PATCH`), then the list is read again. */
  readonly rename: (label: string) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
  /** Sign in again, for a login that needs it: the same sign-in as adding one, renewing this subscription in place. */
  readonly onSignIn: (provider: SignInProvider, credentialId: string) => void;
  /** Just signed in (added or renewed): scrolled into view and ringed for a moment, so it is found below the fold. */
  readonly highlighted?: boolean;
}

/** Its limits: the bars of a plan, a line for keys and gateways, nothing for a revoked one. */
function CardLimits({
  subscription,
  limits,
  now,
}: Pick<SubscriptionCardProps, 'subscription' | 'limits' | 'now'>) {
  if (subscription.status === 'revoked') return null;
  if (!hasLimits(subscription.kind)) return <p className="text-sm text-dim">No limits (pay as you go).</p>;
  if (!limits) return <p className="text-sm text-dim">Checking its limits…</p>;
  return <LimitMeters limits={limits} now={now} />;
}

/** When it was added and last used by the server (a limits check, later a run). */
function UseLine({ subscription }: { readonly subscription: Subscription }) {
  const { createdAt, lastUsedAt } = subscription;
  return (
    <p className="min-w-0 text-xs text-dim">
      Added <time dateTime={createdAt}>{formatDate(createdAt)}</time>
      {lastUsedAt && (
        <>
          {' · used '}
          <time dateTime={lastUsedAt} title={formatDateTime(lastUsedAt)}>
            {fromNow(lastUsedAt)}
          </time>
        </>
      )}
    </p>
  );
}

/**
 * One subscription on the Subscriptions page: its kind and state, its name (renamed in place) and account, Sign in
 * again for a login that needs it, its limits, and Remove, confirmed in place.
 */
export function SubscriptionCard({
  subscription,
  limits,
  now,
  rename,
  remove,
  onSignIn,
  highlighted = false,
}: SubscriptionCardProps) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);
  const provider = signInOf(subscription.kind);
  const account = accountLine(subscription);
  return (
    <Card
      ref={card}
      as="article"
      aria-label={subscription.label}
      className={cx('flex flex-col gap-4 transition-shadow duration-500', highlighted && 'ring-2 ring-blue')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={subscription.kind} />
            {subscription.status !== 'active' && <StatusPill status={subscription.status} size="sm" />}
          </div>
          <InlineEdit
            value={subscription.label}
            label={`Rename ${subscription.label}`}
            maxLength={CREDENTIAL_LABEL.max}
            onSave={rename}
            className="mt-2"
          >
            <span className="text-md font-bold tracking-[-0.01em] text-ink">{subscription.label}</span>
          </InlineEdit>
          {account && <p className="truncate text-sm text-dim">{account}</p>}
        </div>
        {provider && subscription.status === 'needs_sign_in' && (
          <Button size="sm" tone="primary" icon={LogIn} onClick={() => onSignIn(provider, subscription.id)}>
            Sign in again
          </Button>
        )}
      </header>
      <CardLimits subscription={subscription} limits={limits} now={now} />
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <UseLine subscription={subscription} />
        <ConfirmInline
          label="Remove"
          question={`Remove ${subscription.label}? Agents using it lose it, and it leaves your profiles.`}
          confirmLabel="Remove"
          onConfirm={remove}
        />
      </footer>
    </Card>
  );
}
