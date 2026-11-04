import { useCallback, useEffect, useState } from 'react';
import { fetchApiStatus, type ApiStatus as Status } from '../../api/client.ts';
import { Button, ButtonLink } from '../ui/Button.tsx';

type Shown = Status | { readonly kind: 'checking' };

const TONE: Readonly<Record<Shown['kind'], string>> = {
  checking: 'bg-faint',
  ready: 'bg-done',
  not_ready: 'bg-input',
  unreachable: 'bg-failed',
};

function statusText(status: Shown): string {
  switch (status.kind) {
    case 'checking':
      return 'Checking the API…';
    case 'ready':
      return `API ${status.version} is up and ready`;
    case 'not_ready':
      return `API ${status.version} is up but not ready: ${status.reason}`;
    case 'unreachable':
      return 'The API does not answer';
  }
}

/** Whether the API answers and is ready (its version and readiness), with a button to ask again. */
export function ApiStatus() {
  const [status, setStatus] = useState<Shown>({ kind: 'checking' });
  const check = useCallback(async () => {
    setStatus({ kind: 'checking' });
    setStatus(await fetchApiStatus());
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" aria-live="polite" className="flex items-center gap-2.5 text-sm font-medium text-ink">
        <span
          aria-hidden="true"
          className={`inline-block size-2 shrink-0 rounded-full ${TONE[status.kind]}`}
        />
        {statusText(status)}
      </p>
      <div className="flex items-center gap-2">
        <ButtonLink href="/api/docs" external size="sm" tone="quiet">
          API docs
        </ButtonLink>
        <Button size="sm" onClick={() => void check()} disabled={status.kind === 'checking'}>
          Check again
        </Button>
      </div>
    </div>
  );
}
