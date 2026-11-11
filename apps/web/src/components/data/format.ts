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

const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** A date with its weekday and time ("Tue, Nov 10, 6:00 PM"), for a moment within the coming days. */
export function formatWeekdayTime(iso: string): string {
  return WEEKDAY_TIME.format(new Date(iso));
}

/** A span of time as people read it, to the minute ("2d 3h", "1h 56m", "42m", "less than a minute"). */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  const rest = minutes % 60;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/** A byte count as people read it ("812 B", "48 KB", "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A count with its noun ("1 member", "3 members"). */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long ago, short: "now", "5 min", "3 h", "2 d", then the date. */
export function ago(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime());
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < 7 * DAY_MS) return `${Math.floor(ms / DAY_MS)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
