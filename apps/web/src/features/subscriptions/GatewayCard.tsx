import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { Lock } from 'lucide-react';
import type { AccessProfile, Subscription } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { formatDate, formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { KindBadge } from './KindBadge.tsx';

interface GatewayCardProps {
  readonly gateway: Subscription;
  /** The person's access profiles that have it in their gateway slot; undefined while they load. */
  readonly profiles: readonly AccessProfile[] | undefined;
  /** Renames it (`PATCH`), then the list is read again. */
  readonly rename: (label: string) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
}

/** Its address, as the server shows it (`accountMeta.baseUrl`). */
const addressOf = (gateway: Subscription): string | undefined => {
  const value = gateway.accountMeta.baseUrl;
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** The profiles that include it, each a link to the Access profiles tab. */
function GatewayProfiles({ profiles }: { readonly profiles: readonly AccessProfile[] | undefined }) {
  const profilesHref = usePersonalHref('profiles');
  if (profiles === undefined) return <p className="text-xs text-dim">Checking your access profiles…</p>;
  if (profiles.length === 0)
    return (
      <p className="text-xs text-dim">No access profile includes it yet. Choose it in a profile’s Gateway.</p>
    );
  return (
    <div>
      <p className="text-xs font-semibold text-dim">In {profiles.length === 1 ? 'profile' : 'profiles'}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <Link
              to={profilesHref}
              className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 hover:text-teal focus-visible:text-teal"
            >
              {profile.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One AI gateway: its name (renamed in place), its address, a note that its headers are sealed (never their names or
 * values), the access profiles that include it, and Remove, confirmed in place.
 */
export function GatewayCard({ gateway, profiles, rename, remove }: GatewayCardProps) {
  const address = addressOf(gateway);
  const { createdAt, lastUsedAt } = gateway;
  return (
    <Card as="article" aria-label={gateway.label} className="flex flex-col gap-4">
      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={gateway.kind} />
          {gateway.status !== 'active' && <StatusPill status={gateway.status} size="sm" />}
        </div>
        <InlineEdit
          value={gateway.label}
          label={`Rename ${gateway.label}`}
          maxLength={CREDENTIAL_LABEL.max}
          onSave={rename}
          className="mt-2"
        >
          <span className="text-md font-bold tracking-[-0.01em] text-ink">{gateway.label}</span>
        </InlineEdit>
        {address && <p className="truncate font-mono text-sm text-ink-2">{address}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-xs text-dim">
          <Lock size={13} aria-hidden="true" className="shrink-0" />
          Its headers are stored encrypted and never shown.
        </p>
      </header>
      <GatewayProfiles profiles={profiles} />
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
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
        <ConfirmInline
          label="Remove"
          question={`Remove ${gateway.label}? It leaves your access profiles, and agents using them stop sending requests through it.`}
          confirmLabel="Remove"
          onConfirm={remove}
        />
      </footer>
    </Card>
  );
}
