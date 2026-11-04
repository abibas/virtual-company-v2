const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** A date as people read it ("4 Nov 2026"); `empty` for none. */
export function formatDate(iso: string | null | undefined, empty = '—'): string {
  return iso ? DATE.format(new Date(iso)) : empty;
}

/** A date and time ("4 Nov 2026, 21:04"), for a title attribute; empty for none. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? DATE_TIME.format(new Date(iso)) : '';
}

/** The time of day of a date ("08:30"). */
export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** How far a date is from now in days ("in 12 days", "yesterday", "today"); `empty` for none. */
export function fromNow(iso: string | null | undefined, empty = '—', now = Date.now()): string {
  if (!iso) return empty;
  const days = Math.round((new Date(iso).getTime() - now) / DAY_MS);
  return RELATIVE.format(days, 'day');
}

/** A count with its noun ("1 member", "3 members"). */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
