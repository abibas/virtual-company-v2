/** How the thread words times, models and paths (S5.2). Pure. */

/** A running time as people read it: "45s", "1m 12s", "1h 3m". */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A finished length, rounded: "12s", "3m", "1h 5m". */
export function roundedDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The milliseconds between two ISO times; undefined when either is missing. */
export function between(from: string | null | undefined, to: string | null | undefined): number | undefined {
  if (!from || !to) return undefined;
  return new Date(to).getTime() - new Date(from).getTime();
}

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];

/** A model id as people read it: `claude-opus-5-5[1m]` → "Opus 5.5 · 1M"; anything else as it is. */
export function modelLabel(model: string): string {
  const window = /\[(\d+[km])\]$/i.exec(model)?.[1];
  const bare = model.replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '');
  const [family, ...rest] = bare.split('-');
  if (family === undefined || !FAMILIES.includes(family.toLowerCase())) return model;
  const version = rest.filter((part) => /^\d{1,2}$/.test(part)).join('.');
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`;
  return window ? `${name} · ${window.toUpperCase()}` : name;
}

/** The last part of a path: `src/app/main.ts` → "main.ts". */
export function basename(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).at(-1) || trimmed;
}

/** A line cut to `max` characters, ending in "…" when cut. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** "1 file", "3 files". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "a" or "an" before a word. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
