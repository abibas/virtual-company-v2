import { useState } from 'react';
import type { ApiKey } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Switch } from '../forms/Switch.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Panel } from '../ui/Panel.tsx';
import { SkeletonRow } from '../ui/Skeleton.tsx';
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
  const toggle = admin && <Switch checked={everyone} onChange={onEveryone} label="Show everyone’s keys" />;
  return (
    <Panel
      title={everyone ? 'Everyone’s keys' : 'Your keys'}
      description="Each key acts as its owner, in this company only."
      actions={toggle}
    >
      {revoked && (
        <div className="mb-4">
          <Notice tone="success" onDismiss={() => setRevoked(undefined)}>
            {revoked}
          </Notice>
        </div>
      )}
      <LoadState
        loaded={keys}
        label="Loading keys…"
        skeleton={
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        }
      >
        {(data) => (
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
        )}
      </LoadState>
    </Panel>
  );
}
