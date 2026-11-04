const DAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Midnight of a date's day, in local time. */
function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", else "Sat, 24 Oct". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return DAY_LABEL.format(date);
}

export interface DayGroupOf<T> {
  readonly label: string;
  readonly items: readonly T[];
}

/** Items grouped by their day, newest day first and newest item first within it. */
export function groupByDay<T>(
  items: readonly T[],
  at: (item: T) => string,
  now: Date = new Date(),
): DayGroupOf<T>[] {
  const sorted = [...items].sort((a, b) => new Date(at(b)).getTime() - new Date(at(a)).getTime());
  const groups: { label: string; items: T[] }[] = [];
  for (const item of sorted) {
    const label = dayLabel(at(item), now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
