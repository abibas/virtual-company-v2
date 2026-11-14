import { useState } from 'react';

/**
 * A live list that does not move under the pointer (2026-11-14): while the pointer is over it, the rows keep the order
 * they had when it came in (a new row goes on top, a gone one leaves); once it leaves, the list takes its live order.
 * The rows' contents (a title, a dot) still change in place.
 */
export function useSteadyOrder<T extends { readonly id: string }>(items: readonly T[]) {
  const [held, setHeld] = useState<readonly string[] | null>(null);
  const shown =
    held === null
      ? items
      : [
          ...items.filter((item) => !held.includes(item.id)),
          ...held.flatMap((id) => items.find((item) => item.id === id) ?? []),
        ];
  const hold = {
    onPointerEnter: () => setHeld(items.map((item) => item.id)),
    onPointerLeave: () => setHeld(null),
  };
  return { shown, hold };
}
