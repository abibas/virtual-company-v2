import { GATEWAY_ROUTES } from '@mwc/shared/credentials';
import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { Subscription, SubscriptionChanges } from '../../api/types.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import {
  GatewayAddress,
  GatewayPathsFold,
  type HeaderRow,
  HeaderRows,
  type PathValues,
  pathsOf,
} from './GatewayFields.tsx';

/** Its address and paths as the form holds them: each path its own, or empty for its default. */
function startOf(gateway: Subscription): { readonly baseUrl: string; readonly paths: PathValues } {
  const { baseUrl, paths } = gateway.accountMeta;
  const own = (typeof paths === 'object' && paths !== null ? paths : {}) as Record<string, unknown>;
  return {
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    paths: Object.fromEntries(
      GATEWAY_ROUTES.map((route) => [route, typeof own[route] === 'string' ? own[route] : '']),
    ) as unknown as PathValues,
  };
}

/** A row left entirely empty is not a header. */
const isBlank = (row: HeaderRow) => row.from === undefined && row.name.trim() === '' && row.value === '';

/** A row as the API takes it: its name, the stored header it continues, and a value only when one was typed. */
const editOf = (row: HeaderRow) => ({
  name: row.name.trim(),
  ...(row.from === undefined ? {} : { from: row.from }),
  ...(row.value === '' ? {} : { value: row.value }),
});

interface GatewayEditProps {
  readonly gateway: Subscription;
  /** Sends the change (`PATCH`); the list is read again after it. */
  readonly save: (changes: SubscriptionChanges) => Promise<unknown>;
  readonly onDone: () => void;
}

/**
 * Edit a gateway in place: its address, its paths (folded) and its headers, each kept, renamed, given a new value
 * (typed: the stored one is never shown), removed or added. A gateway whose headers are not listed (no previews)
 * edits its address and paths only, so its headers stay as they are.
 */
export function GatewayEdit({ gateway, save, onDone }: GatewayEditProps) {
  const start = startOf(gateway);
  const [baseUrl, setBaseUrl] = useState(start.baseUrl);
  const [paths, setPaths] = useState(start.paths);
  const [rows, setRows] = useState<readonly HeaderRow[]>(() =>
    (gateway.headers ?? []).map((header, id) => ({ id, name: header.name, value: '', from: header.name })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const headers = rows.filter((row) => !isBlank(row));
  const ready =
    baseUrl.trim() !== '' &&
    headers.every((row) => row.name.trim() !== '' && (row.from !== undefined || row.value !== ''));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await save({
        baseUrl: baseUrl.trim(),
        paths: pathsOf(paths),
        ...(gateway.headers === null ? {} : { headers: headers.map(editOf) }),
      });
      onDone();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} aria-label={`Edit ${gateway.label}`} className="mt-3 flex flex-col gap-4">
      <GatewayAddress value={baseUrl} onChange={setBaseUrl} />
      {gateway.headers !== null && <HeaderRows rows={rows} onChange={setRows} editing />}
      <GatewayPathsFold values={paths} onChange={setPaths} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" tone="primary" busy={busy} disabled={!ready}>
          Save
        </Button>
      </div>
    </form>
  );
}
