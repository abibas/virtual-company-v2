import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { LogIn } from 'lucide-react';
import type { SignInProvider, Subscription, SubscriptionLimits } from '../../api/types.ts';
import { formatDate, formatDateTime, fromNow } from '../data/format.ts';
import { ConfirmInline } from '../forms/ConfirmInline.tsx';
import { InlineEdit } from '../forms/InlineEdit.tsx';
import { StatusPill } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
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
  /** Sign in again, for a login that needs it: the same sign-in as adding one. */
  readonly onSignIn: (provider: SignInProvider) => void;
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
}: SubscriptionCardProps) {
  const provider = signInOf(subscription.kind);
  const account = accountLine(subscription);
  return (
    <Card as="article" aria-label={subscription.label} className="flex flex-col gap-4">
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
          <Button size="sm" tone="primary" icon={LogIn} onClick={() => onSignIn(provider)}>
            Sign in again
          </Button>
        )}
      </header>
      <CardLimits subscription={subscription} limits={limits} now={now} />
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <UseLine subscription={subscription} />
        <ConfirmInline
          label="Remove"
          question={`Remove ${subscription.label}? Agents using it lose it, and it leaves your access profiles.`}
          confirmLabel="Remove"
          onConfirm={remove}
        />
      </footer>
    </Card>
  );
}
