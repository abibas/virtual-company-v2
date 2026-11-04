import { useState } from 'react';
import type { ApiKey } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Panel } from '../ui/Panel.tsx';
import { KeyTable } from './KeyTable.tsx';

interface KeysPanelProps {
  readonly companyId: string;
  readonly keys: Loaded<{ readonly apiKeys: readonly ApiKey[] }>;
  readonly myUserId: string;
  /** Admins and owners may switch to everyone's keys. */
  readonly admin: boolean;
  readonly everyone: boolean;
  readonly onEveryone: (everyone: boolean) => void;
}

/** The keys list: mine, or (admins and owners) everyone's with their owners; revoke from here. */
export function KeysPanel({ companyId, keys, myUserId, admin, everyone, onEveryone }: KeysPanelProps) {
  const [revoked, setRevoked] = useState<string>();
  const toggle = admin && (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
      <input
        type="checkbox"
        checked={everyone}
        onChange={(event) => onEveryone(event.target.checked)}
        className="size-4 accent-amber"
      />
      Show everyone’s keys
    </label>
  );
  return (
    <Panel title={everyone ? 'Everyone’s keys' : 'Your keys'} actions={toggle}>
      {revoked && (
        <div className="mb-3">
          <Notice tone="success">{revoked}</Notice>
        </div>
      )}
      <LoadState loaded={keys} label="Loading keys…">
        {(data) => (
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <KeyTable
              companyId={companyId}
              keys={data.apiKeys}
              everyone={everyone}
              myUserId={myUserId}
              onRevoked={(key) => {
                setRevoked(`“${key.name}” is revoked. Anything still using it is refused.`);
                keys.reload();
              }}
            />
          </div>
        )}
      </LoadState>
    </Panel>
  );
}
