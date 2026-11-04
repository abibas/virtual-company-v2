import { Search } from 'lucide-react';
import { type ComponentPropsWithRef, useEffect, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { commandKey, KbdHint } from './KbdHint.tsx';

export interface SearchBoxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> {
  /** ⌘K (Ctrl+K elsewhere) focuses the box from anywhere on the page. */
  readonly shortcut?: boolean;
  readonly size?: 'md' | 'lg';
}

/** The search box of the top bar: a magnifier, the input, and the ⌘K hint. Searching itself comes later. */
export function SearchBox({
  shortcut = true,
  size = 'md',
  className,
  placeholder = 'Search',
  'aria-label': ariaLabel = 'Search',
  ...rest
}: SearchBoxProps) {
  const input = useRef<HTMLInputElement>(null);
  const [key] = useState(commandKey);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  return (
    <label
      className={cx(
        'group/search flex min-w-0 items-center gap-2.5 rounded-xl bg-surface px-3.5 text-ink shadow-card ring-1 ring-transparent transition-[box-shadow] duration-150 focus-within:ring-blue',
        size === 'lg' ? 'h-12' : 'h-11',
        className,
      )}
    >
      <Search size={17} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-dim" />
      <input
        ref={input}
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {shortcut && <KbdHint keys={[key, 'K']} className="shrink-0 group-focus-within/search:opacity-0" />}
    </label>
  );
}
