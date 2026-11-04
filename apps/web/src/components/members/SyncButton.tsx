import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { CompanySync } from '../../api/types.ts';
import { Button } from '../ui/Button.tsx';

/** What a sync did, in one sentence. */
export function syncSummary(sync: CompanySync): string {
  if (sync.organization === 'pending') {
    return 'This company is still being set up with the sign-in service, so there is nothing to sync yet.';
  }
  const changes = sync.changed + sync.removed;
  if (changes === 0) return 'Synced with the sign-in service: everything already matched.';
  return `Synced with the sign-in service: ${changes} ${changes === 1 ? 'change' : 'changes'} applied here.`;
}

/**
 * Sync now (admins and owners): brings members and invitations in line with the sign-in service at once, instead of
 * waiting for the periodic sync, for example right after someone accepted an invitation.
 */
export function SyncButton({
  companyId,
  onSynced,
  onFailed,
}: {
  readonly companyId: string;
  readonly onSynced: (sync: CompanySync) => void;
  readonly onFailed: (error: unknown) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      onSynced(await call(api.api.companies[':companyId'].sync.$post({ param: { companyId } })));
    } catch (failure) {
      onFailed(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" icon={RefreshCw} busy={busy} onClick={() => void sync()}>
      Sync now
    </Button>
  );
}
