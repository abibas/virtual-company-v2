const DATE_LINE = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** "Good morning" until noon, "Good afternoon" until six, then "Good evening". */
export function greetingFor(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "Tuesday, 4 November". */
export function dateLine(now: Date = new Date()): string {
  return DATE_LINE.format(now);
}

/** The name to greet someone by: their first name, else the part of their email before the @. */
export function firstName(displayName: string, email = ''): string {
  const name = displayName.trim().split(/\s+/)[0];
  if (name) return name;
  return email.split('@')[0] || 'there';
}
