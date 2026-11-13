import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { useFolderMissing } from '../../api/folders.ts';
import { Button } from '../../components/ui/Button.tsx';

/**
 * Under the home folder of a saved agent on an online machine whose folder is not there yet (2026-11-13): "Not on the
 * machine yet" with **Create**, which makes it with its parents through the runner. Nothing otherwise.
 */
export function HomeMissingLine({
  companyId,
  machineId,
  path,
  wanted,
}: {
  readonly companyId: string;
  readonly machineId: string;
  readonly path: string;
  readonly wanted: boolean;
}) {
  const folder = useFolderMissing(companyId, machineId, path, wanted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!wanted || folder.missing !== true) return null;
  const create = () => {
    setBusy(true);
    setError(undefined);
    folder
      .create()
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-input">Not on the machine yet</span>
      <Button size="sm" tone="soft" busy={busy} onClick={create} className="h-6 px-2.5 text-xs">
        Create
      </Button>
      {error && (
        <span role="alert" className="text-failed">
          {error}
        </span>
      )}
    </span>
  );
}
