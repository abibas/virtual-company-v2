import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { AccessProfile, Subscription, SubscriptionChanges } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { formatDate, formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { GatewayEdit } from './GatewayEdit.tsx';
import { GatewayRoutes } from './GatewayFields.tsx';
import { KindBadge } from './KindBadge.tsx';

interface GatewayCardProps {
  readonly gateway: Subscription;
  /** The person's profiles that have it as their gateway; undefined while they load. */
  readonly profiles: readonly AccessProfile[] | undefined;
  /** Renames it (`PATCH`), then the list is read again. */
  readonly rename: (label: string) => Promise<unknown>;
  /** Changes its address, paths and headers (`PATCH`), then the list is read again. */
  readonly update: (changes: SubscriptionChanges) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
}

/** Its address, as the server shows it (`accountMeta.baseUrl`). */
const addressOf = (gateway: Subscription): string | undefined => {
  const value = gateway.accountMeta.baseUrl;
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** The profiles that include it, each a link to the Profiles tab; with none, where to choose it. */
function GatewayProfiles({ profiles }: { readonly profiles: readonly AccessProfile[] | undefined }) {
  const profilesHref = usePersonalHref('profiles');
  if (profiles === undefined) return <p className="text-xs text-dim">Checking your profiles…</p>;
  if (profiles.length === 0) {
    return (
      <p className="text-xs text-dim">
        No profile includes it yet. Choose it as the gateway of a profile’s Claude or OpenAI part.
      </p>
    );
  }
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

/** Its headers, one per line: "x-api-key: agk-NTE5••••MHx8" (the server's previews, never a value). */
function GatewayHeaders({ headers }: { readonly headers: Subscription['headers'] }) {
  if (headers === null || headers.length === 0) return null;
  return (
    <ul aria-label="Headers" className="mt-2 flex flex-col gap-0.5 font-mono text-xs">
      {headers.map((header) => (
        <li key={header.name} className="truncate">
          <span className="text-ink-2">{header.name}:</span>{' '}
          <span className="text-dim">{header.preview}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One AI gateway, for Claude Code and Codex alike: its name (renamed in place), its address with where each CLI reaches
 * it, its headers as names and previews, the access profiles that include it, Edit (the address, paths and headers in
 * place) and Remove, confirmed in place.
 */
export function GatewayCard({ gateway, profiles, rename, update, remove }: GatewayCardProps) {
  const address = addressOf(gateway);
  const { createdAt, lastUsedAt } = gateway;
  const [editing, setEditing] = useState(false);
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
        {editing ? (
          <GatewayEdit gateway={gateway} save={update} onDone={() => setEditing(false)} />
        ) : (
          <>
            {address && <p className="truncate font-mono text-sm text-ink-2">{address}</p>}
            <GatewayRoutes accountMeta={gateway.accountMeta} />
            <GatewayHeaders headers={gateway.headers} />
          </>
        )}
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
        <div className="flex flex-wrap items-center gap-2">
          {!editing && (
            <Button size="sm" tone="quiet" icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <ConfirmInline
            label="Remove"
            question={`Remove ${gateway.label}? It leaves your profiles, and agents using them stop sending requests through it.`}
            confirmLabel="Remove"
            onConfirm={remove}
          />
        </div>
      </footer>
    </Card>
  );
}
