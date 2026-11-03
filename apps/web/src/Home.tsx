import { useCallback, useEffect, useState } from 'react';
import { type ApiStatus, fetchApiStatus } from './api.ts';

type Shown = ApiStatus | { readonly kind: 'checking' };

const TONE: Record<Shown['kind'], string> = {
  checking: 'bg-faint',
  ready: 'bg-pulse',
  not_ready: 'bg-amber',
  unreachable: 'bg-alarm',
};

function statusText(status: Shown): string {
  switch (status.kind) {
    case 'checking':
      return 'Checking the API…';
    case 'ready':
      return `API v${status.version} · ready`;
    case 'not_ready':
      return `API v${status.version} · not ready: ${status.reason}`;
    case 'unreachable':
      return 'API unreachable';
  }
}

export function Home() {
  const [status, setStatus] = useState<Shown>({ kind: 'checking' });

  const check = useCallback(async () => {
    setStatus({ kind: 'checking' });
    setStatus(await fetchApiStatus());
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <p className="font-mono text-label uppercase tracking-label text-dim">Stage S0 · skeleton</p>
      <h1 className="mt-2 font-display text-[32px] font-[450] leading-tight text-ink">Home</h1>
      <p className="mt-3 max-w-prose text-ink-2">
        Humans and AI agents in one organization. The inbox, tasks, org chart and machines arrive stage by
        stage; for now this page shows whether the API is up.
      </p>

      <section
        aria-labelledby="api-heading"
        className="mt-8 rounded-md border border-line bg-panel-solid p-4 md:p-5"
      >
        <h2 id="api-heading" className="font-mono text-label uppercase tracking-label text-dim">
          API
        </h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2.5 font-mono text-[15px] text-ink"
          >
            <span
              aria-hidden="true"
              className={`inline-block size-2 shrink-0 rounded-full ${TONE[status.kind]}`}
            />
            <span data-testid="api-status">{statusText(status)}</span>
          </p>
          <div className="flex items-center gap-2">
            <a
              href="/api/docs"
              className="rounded-sm border border-line-2 px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink"
            >
              API docs
            </a>
            <button
              type="button"
              onClick={() => void check()}
              disabled={status.kind === 'checking'}
              className="cursor-pointer rounded-sm border border-line-2 px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              Check again
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
