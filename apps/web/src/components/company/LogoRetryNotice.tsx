import { useState } from 'react';
import { uploadCompanyLogo } from '../../api/company-logo.ts';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { clearPendingLogo, type PendingLogo } from '../../api/pending-logo.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/**
 * The company was created but its logo was not uploaded: why, and the upload again from the same bytes. Dismissing
 * it drops the bytes; the logo can always be added on Settings.
 */
export function LogoRetryNotice({
  pending,
  onUploaded,
}: {
  readonly pending: PendingLogo;
  /** After a successful upload: reads the session again, so the new version reaches every badge. */
  readonly onUploaded: () => Promise<unknown>;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(pending.error);
  const retry = async () => {
    setBusy(true);
    try {
      await uploadCompanyLogo(api, pending.companyId, pending.blob);
      await onUploaded();
      clearPendingLogo(pending.companyId);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };
  return (
    <Notice
      tone="warning"
      title="The company is here, its logo is not"
      action={
        <Button size="sm" busy={busy} onClick={() => void retry()}>
          Upload the logo again
        </Button>
      }
      onDismiss={() => clearPendingLogo(pending.companyId)}
    >
      {friendlyMessage(error)} You can also add a logo on Settings at any time.
    </Notice>
  );
}
