import { cx } from '../cx.ts';

/** Keys to press, each in a small key cap: `['⌘', 'K']`. */
export function KbdHint({
  keys,
  className,
}: {
  readonly keys: readonly string[];
  readonly className?: string;
}) {
  return (
    <kbd className={cx('inline-flex items-center gap-0.5 font-sans', className)}>
      {keys.map((key) => (
        <span
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-surface px-1 text-2xs font-semibold text-dim ring-1 ring-line-2 ring-inset"
        >
          {key}
        </span>
      ))}
    </kbd>
  );
}

/** The platform's command key: ⌘ on a Mac, Ctrl elsewhere. */
export function commandKey(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}
