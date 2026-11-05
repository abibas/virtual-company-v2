import { useSyncExternalStore } from 'react';

/**
 * A logo picked on the create-company page whose upload failed after the company was made. The company exists and
 * the person lands in it; its page offers the upload again from these bytes, kept in memory for this page load.
 */
export interface PendingLogo {
  readonly companyId: string;
  readonly blob: Blob;
  readonly error: unknown;
}

const pending = new Map<string, PendingLogo>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps the bytes and why they were refused, for the company's page to try again. */
export function rememberPendingLogo(companyId: string, blob: Blob, error: unknown): void {
  pending.set(companyId, { companyId, blob, error });
  notify();
}

export function clearPendingLogo(companyId: string): void {
  if (pending.delete(companyId)) notify();
}

/** The logo still to upload for this company, if any. */
export function usePendingLogo(companyId: string): PendingLogo | undefined {
  return useSyncExternalStore(subscribe, () => pending.get(companyId));
}
