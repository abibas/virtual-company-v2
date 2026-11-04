import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import type { ProjectionChange } from '../../src/projector.ts';

export type Event<T extends NormalizedIdentityEvent['type']> = Extract<NormalizedIdentityEvent, { type: T }>;

export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The first event of a type. */
export function first<T extends NormalizedIdentityEvent['type']>(
  events: readonly NormalizedIdentityEvent[],
  type: T,
): Event<T> {
  return must(events.find((e): e is Event<T> => e.type === type));
}

/** The event as the provider would send a different state of it (a new delivery id). */
let variants = 0;
export function variant<E extends NormalizedIdentityEvent>(event: E, data: Partial<E['data']>): E {
  variants++;
  return {
    ...event,
    externalEventId: `${event.externalEventId}~${variants}`,
    data: { ...event.data, ...data },
  } as E;
}

export function actions(changes: readonly ProjectionChange[]): string[] {
  return changes.map((c) => `${c.entity}:${c.action}${c.reason ? `:${c.reason}` : ''}`);
}
