import { KeyRound } from 'lucide-react';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { ApiKey } from '../../api/types.ts';
import { type Column, DataTable, Primary } from '../../components/data/DataTable.tsx';
import { formatDate, formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';

interface KeyTableProps {
  readonly companyId: string;
  readonly keys: readonly ApiKey[];
  /** Everyone's keys, with their owners (admins and owners). */
  readonly everyone: boolean;
  readonly myUserId: string;
  readonly onRevoked: (key: ApiKey) => void;
}

/** A date as "in 12 days" or "yesterday", with the exact time on hover; `empty` for none. */
function When({ iso, empty }: { readonly iso: string | null; readonly empty: string }) {
  if (!iso) return empty;
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {fromNow(iso)}
    </time>
  );
}

/** Revoke, while the key is active; the question names the owner when it is not the person's own key. */
function RevokeControl({
  apiKey: key,
  myUserId,
  onRevoke,
}: {
  readonly apiKey: ApiKey;
  readonly myUserId: string;
  readonly onRevoke: (key: ApiKey) => Promise<void>;
}) {
  if (key.status !== 'active') return null;
  const owner = key.owner;
  const ownerName = owner?.displayName || owner?.email;
  const mine = !owner || owner.userId === myUserId;
  return (
    <ConfirmInline
      label="Revoke"
      question={
        mine
          ? `Revoke “${key.name}”? Anything using it is refused from now on.`
          : `Revoke ${ownerName}’s key “${key.name}”? It is refused from now on.`
      }
      confirmLabel="Revoke"
      onConfirm={() => onRevoke(key)}
    />
  );
}

/** The columns: the key (its name and first characters), its owner (everyone's view), dates, status, Revoke. */
function keyColumns(
  everyone: boolean,
  myUserId: string,
  onRevoke: (key: ApiKey) => Promise<void>,
): readonly Column<ApiKey>[] {
  const owner: Column<ApiKey> = {
    key: 'owner',
    header: 'Owner',
    hide: 'sm',
    cell: (key) => (
      <>
        <p className="break-words text-ink">{key.owner?.displayName || key.owner?.email}</p>
        {key.owner?.displayName && <p className="text-xs break-all text-dim">{key.owner.email}</p>}
      </>
    ),
  };
  return [
    {
      key: 'key',
      header: 'Key',
      cell: (key) => (
        <Primary
          title={key.name}
          subtitle={<span className="font-mono">{key.prefix}…</span>}
          phone={
            <span>
              Made {formatDate(key.createdAt)}, expires <When iso={key.expiresAt} empty="never" />
            </span>
          }
        />
      ),
    },
    ...(everyone ? [owner] : []),
    {
      key: 'expires',
      header: 'Expires',
      hide: 'md',
      className: 'whitespace-nowrap',
      cell: (key) => <When iso={key.expiresAt} empty="Never" />,
    },
    {
      key: 'used',
      header: 'Last used',
      hide: 'md',
      className: 'whitespace-nowrap',
      cell: (key) => <When iso={key.lastUsedAt} empty="Never" />,
    },
    { key: 'status', header: 'Status', cell: (key) => <StatusPill status={key.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      srOnly: true,
      align: 'right',
      cell: (key) => <RevokeControl apiKey={key} myUserId={myUserId} onRevoke={onRevoke} />,
    },
  ];
}

/** Personal API keys: how to recognise each (its first characters and name), its owner, dates and status. */
export function KeyTable({ companyId, keys, everyone, myUserId, onRevoked }: KeyTableProps) {
  const api = useApi();
  const onRevoke = async (key: ApiKey) => {
    const revoked = await call(
      api.api.companies[':companyId']['api-keys'][':keyId'].$delete({ param: { companyId, keyId: key.id } }),
    );
    onRevoked(revoked);
  };
  return (
    <DataTable
      columns={keyColumns(everyone, myUserId, onRevoke)}
      rows={keys}
      rowKey={(key) => key.id}
      empty={
        <EmptyState
          icon={KeyRound}
          tone="teal"
          title={everyone ? 'Nobody has a key yet' : 'No keys yet'}
          size="sm"
        >
          Make one above to sign in the CLI or your own Claude Code.
        </EmptyState>
      }
    />
  );
}
