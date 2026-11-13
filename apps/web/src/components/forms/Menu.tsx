import { Check, type LucideIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { useFloatingPanel } from './floating.ts';

/** Closes an open disclosure on Escape (focus back on its button) or on a click outside it. */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, close, root, button]);
}

const ITEMS = '[role="menuitem"]:not([aria-disabled="true"])';

/** Arrow keys, Home and End move between the items of an open menu; Tab leaves it. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const go = (next: number) => {
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  if (event.key === 'ArrowDown') go(index + 1);
  else if (event.key === 'ArrowUp') go(index - 1);
  else if (event.key === 'Home') go(0);
  else if (event.key === 'End') go(items.length - 1);
  else if (event.key === 'Tab') close();
}

export interface MenuTriggerProps {
  readonly ref: RefObject<HTMLButtonElement | null>;
  readonly 'aria-expanded': boolean;
  readonly 'aria-haspopup': 'menu';
  readonly 'aria-controls': string;
  readonly onClick: () => void;
}

/**
 * A dropdown: the trigger gets the ARIA wiring, the items are `MenuItem`s. Opening focuses the first item; arrow keys
 * move, Escape or a click outside closes (focus back on the trigger); picking an item closes it. `floating` fixes
 * the panel to the window (`useFloatingPanel`), for a trigger inside a scrolling container that would cut it off;
 * `side` says where it opens first (`above`: a trigger at the bottom, as the composer's menus).
 */
export function Menu({
  trigger,
  align = 'start',
  width = 'w-64',
  floating = false,
  side = 'below',
  children,
}: {
  readonly trigger: (props: MenuTriggerProps) => ReactNode;
  readonly align?: 'start' | 'end';
  readonly width?: string;
  readonly floating?: boolean;
  readonly side?: 'below' | 'above';
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  const place = useFloatingPanel(open && floating, align, button, panel, close, side);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: floating });
  }, [open, floating]);

  return (
    <div ref={root} className="relative inline-flex min-w-0">
      {trigger({
        ref: button,
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        'aria-controls': id,
        onClick: () => setOpen((was) => !was),
      })}
      <div
        ref={panel}
        id={id}
        role="menu"
        hidden={!open}
        onKeyDown={(event) => moveFocus(event, close)}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[role="menuitem"]')) close();
        }}
        style={floating ? place : undefined}
        className={cx(
          'max-h-[min(36rem,85dvh)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-surface p-1.5 shadow-float ring-1 ring-line',
          floating
            ? 'z-40'
            : cx(
                'absolute z-30',
                side === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
                align === 'start' ? 'left-0' : 'right-0',
              ),
          width,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface MenuItemProps {
  readonly href?: string;
  readonly onSelect?: () => void;
  readonly icon?: LucideIcon;
  /** Replaces the icon (a company's logo). */
  readonly leading?: ReactNode;
  readonly description?: ReactNode;
  readonly trailing?: ReactNode;
  /** The item that is in effect now (a check mark). */
  readonly current?: boolean;
  readonly tone?: 'default' | 'danger' | 'accent';
  readonly disabled?: boolean;
  readonly children: ReactNode;
}

const TONES = { default: 'text-ink', danger: 'text-failed', accent: 'text-blue' } as const;

/** One line of a menu: a link or an action, with an optional icon, description and trailing note. */
export function MenuItem({
  href,
  onSelect,
  icon: Icon,
  leading,
  description,
  trailing,
  current = false,
  tone = 'default',
  disabled = false,
  children,
}: MenuItemProps) {
  const className = cx(
    'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-surface-2 focus:bg-surface-2 focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
    TONES[tone],
    current && 'bg-surface-2',
  );
  const body = (
    <>
      {leading ??
        (Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-dim" />)}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block truncate text-xs font-normal text-dim">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 text-xs text-dim">{trailing}</span>}
      {current && <Check size={15} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-blue" />}
    </>
  );
  if (href !== undefined && !disabled) {
    return (
      <Link
        to={href}
        role="menuitem"
        tabIndex={-1}
        aria-current={current ? 'page' : undefined}
        className={className}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onSelect}
      className={className}
    >
      {body}
    </button>
  );
}

/** A heading over a group of items. */
export function MenuLabel({ children }: { readonly children: ReactNode }) {
  return <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-dim">{children}</p>;
}

export function MenuSeparator() {
  return <hr className="my-1.5 border-0 border-t border-line" />;
}
