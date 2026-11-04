import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { ApiKey } from '../../api/types.ts';
import { formatDate, formatDateTime, fromNow } from '../data/format.ts';
import { ConfirmInline } from '../forms/ConfirmInline.tsx';
import { StatusPill } from '../ui/Badge.tsx';

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

/** One key: its name and first characters, its owner (everyone's view), dates, status and Revoke while active. */
function KeyRow({
  apiKey: key,
  everyone,
  myUserId,
  onRevoke,
}: Pick<KeyTableProps, 'everyone' | 'myUserId'> & {
  readonly apiKey: ApiKey;
  readonly onRevoke: (key: ApiKey) => Promise<void>;
}) {
  const owner = key.owner;
  const ownerName = owner?.displayName || owner?.email;
  const mine = !owner || owner.userId === myUserId;
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className="py-3 pr-3">
        <p className="font-medium break-words text-ink">{key.name}</p>
        <p className="font-mono text-[12.5px] text-dim">{key.prefix}…</p>
        <p className="mt-1 text-[12.5px] text-dim md:hidden">
          Made {formatDate(key.createdAt)}, expires <When iso={key.expiresAt} empty="never" />
        </p>
      </td>
      {everyone && (
        <td className="py-3 pr-3 text-[13px] max-sm:hidden">
          <p className="break-words text-ink-2">{ownerName}</p>
          {owner?.displayName && <p className="text-[12.5px] break-all text-dim">{owner.email}</p>}
        </td>
      )}
      <td className="py-3 pr-3 text-[13px] whitespace-nowrap text-ink-2 max-md:hidden">
        <When iso={key.expiresAt} empty="Never" />
      </td>
      <td className="py-3 pr-3 text-[13px] whitespace-nowrap text-ink-2 max-md:hidden">
        <When iso={key.lastUsedAt} empty="Never" />
      </td>
      <td className="py-3 pr-3">
        <StatusPill status={key.status} />
      </td>
      <td className="py-3 text-right">
        {key.status === 'active' && (
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
        )}
      </td>
    </tr>
  );
}

/** Personal API keys: how to recognise each (its first characters and name), its owner, dates and status. */
export function KeyTable({ companyId, keys, everyone, myUserId, onRevoked }: KeyTableProps) {
  const api = useApi();
  if (keys.length === 0) {
    return (
      <p className="py-2 text-[13.5px] text-dim">
        {everyone ? 'Nobody has a key yet.' : 'You have no keys yet.'}
      </p>
    );
  }
  const revoke = async (key: ApiKey) => {
    const revoked = await call(
      api.api.companies[':companyId']['api-keys'][':keyId'].$delete({ param: { companyId, keyId: key.id } }),
    );
    onRevoked(revoked);
  };
  const columns = ['Key', ...(everyone ? ['Owner'] : []), 'Expires', 'Last used', 'Status'];
  const hide: Readonly<Record<string, string>> = {
    Owner: 'max-sm:hidden',
    Expires: 'max-md:hidden',
    'Last used': 'max-md:hidden',
  };
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line text-[12.5px] text-dim">
          {columns.map((column) => (
            <th key={column} scope="col" className={`py-2 pr-3 font-medium ${hide[column] ?? ''}`}>
              {column}
            </th>
          ))}
          <th scope="col" className="py-2 text-right font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <KeyRow key={key.id} apiKey={key} everyone={everyone} myUserId={myUserId} onRevoke={revoke} />
        ))}
      </tbody>
    </table>
  );
}
