import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import type { ProviderRoleMap } from '../provider.ts';

export interface ProjectionContext {
  /** The provider's token issuer: users are `(issuer, subject)`. */
  readonly issuer: string;
  /** Only `isAdmin` is read: an admin provider role promotes to admin. */
  readonly roles: Pick<ProviderRoleMap, 'isAdmin'>;
}

/** One changed field; the same shape as `@mwc/db`'s `diffFields`, so S1.3 writes it as audit rows. */
export interface FieldChange {
  readonly field: string;
  readonly old: unknown;
  readonly new: unknown;
}

export type ProjectionAction =
  | 'created'
  | 'updated'
  | 'deactivated'
  | 'removed'
  | 'reactivated'
  | 'accepted'
  | 'revoked'
  /** Nothing to do: older than what is applied, a duplicate, or not ours. */
  | 'ignored'
  /** Parked until its user or company exists. */
  | 'deferred'
  /** Refused by a local rule (unlinked membership, revoked invitation); S1.7 may undo it at the provider. */
  | 'refused';

/** What one event did, for audit rows (S1.3) and for the lifecycle hooks of later stages. */
export interface ProjectionChange {
  readonly entity: 'user' | 'membership' | 'invitation' | 'company';
  readonly action: ProjectionAction;
  /** The local row, when there is one. */
  readonly id: string | null;
  readonly companyId: string | null;
  readonly fields: readonly FieldChange[];
  readonly reason: string | null;
  /** The `externalEventId` of the event that caused it. */
  readonly eventId: string;
}

export type Event<T extends NormalizedIdentityEvent['type']> = Extract<NormalizedIdentityEvent, { type: T }>;

/** Replays the events parked under a key; `project` hands it to the handlers that unpark events. */
export type Replay = (key: string) => Promise<ProjectionChange[]>;

export function change(
  event: NormalizedIdentityEvent,
  entity: ProjectionChange['entity'],
  action: ProjectionAction,
  options: {
    id?: string | null;
    companyId?: string | null;
    fields?: readonly FieldChange[];
    reason?: string;
  } = {},
): ProjectionChange {
  return {
    entity,
    action,
    id: options.id ?? null,
    companyId: options.companyId ?? null,
    fields: options.fields ?? [],
    reason: options.reason ?? null,
    eventId: event.externalEventId,
  };
}

export function diff<T extends object>(
  before: T | undefined,
  after: T,
  fields: readonly (keyof T & string)[],
): FieldChange[] {
  return fields
    .filter((field) => before?.[field] !== after[field])
    .map((field) => ({ field, old: before?.[field] ?? null, new: after[field] }));
}
