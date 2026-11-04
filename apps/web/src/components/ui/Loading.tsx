import type { ReactNode } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Button, Spinner } from './Button.tsx';

/** A loading line for a section or a page, announced politely to screen readers. */
export function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <p role="status" className="flex items-center gap-2.5 py-6 text-dim">
      <Spinner />
      {label}
    </p>
  );
}

/** A failed load: what went wrong, in plain words, with a way to try again. */
export function ErrorBlock({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4">
      <p className="text-alarm">{friendlyMessage(error)}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A page-sized centred column for boot, loading and problem states. */
export function CenteredState({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      {children}
    </main>
  );
}

/** A `useLoad` answer on screen: its data through `children`, its failure with a retry, or the loading line. */
export function LoadState<T>({
  loaded,
  label,
  children,
}: {
  readonly loaded: Loaded<T>;
  readonly label: string;
  readonly children: (data: T) => ReactNode;
}) {
  if (loaded.data !== undefined) return children(loaded.data);
  if (loaded.error !== undefined) return <ErrorBlock error={loaded.error} onRetry={loaded.reload} />;
  return <LoadingBlock label={label} />;
}
