import type { ReactNode } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Button, Spinner } from '../ui/Button.tsx';

/** A loading line for a section or a page, announced politely to screen readers. */
export function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <p role="status" className="flex items-center gap-2.5 py-6 text-sm text-dim">
      <Spinner />
      {label}
    </p>
  );
}

/** A failed load: what went wrong, in plain words, with a way to try again. */
export function ErrorBlock({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4">
      <p className="text-sm font-medium text-failed">{friendlyMessage(error)}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * A `useLoad` answer on screen: its data through `children`, its failure with a retry, or the loading state (the
 * `skeleton` when given, else a line with a spinner).
 */
export function LoadState<T>({
  loaded,
  label,
  skeleton,
  children,
}: {
  readonly loaded: Loaded<T>;
  readonly label: string;
  readonly skeleton?: ReactNode;
  readonly children: (data: T) => ReactNode;
}) {
  if (loaded.data !== undefined) return children(loaded.data);
  if (loaded.error !== undefined) return <ErrorBlock error={loaded.error} onRetry={loaded.reload} />;
  if (skeleton !== undefined) {
    return (
      <div role="status" aria-label={label}>
        {skeleton}
      </div>
    );
  }
  return <LoadingBlock label={label} />;
}
