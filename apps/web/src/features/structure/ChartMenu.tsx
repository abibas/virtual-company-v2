import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/** A card's open menu: which one (`more`, its ⋯; `add`, its +), whose (a principal, or the company), and its button. */
export interface MenuAt {
  readonly kind: 'more' | 'add';
  readonly target: string;
  readonly trigger: HTMLElement;
}

const GAP = 6;
const ITEMS = '[role="menuitem"]:not([aria-disabled="true"])';
const UNPLACED: CSSProperties = { position: 'fixed', top: 0, left: 0, opacity: 0 };

/** Below its button, right edges aligned, above it when the window has no room below; kept inside the window. */
function placeBelow(trigger: HTMLElement, panel: HTMLElement): CSSProperties {
  const box = trigger.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = panel;
  const up = window.innerHeight - box.bottom < height + 2 * GAP && box.top > height + 2 * GAP;
  const left = Math.min(Math.max(GAP, box.right - width), window.innerWidth - width - GAP);
  return { position: 'fixed', top: up ? box.top - GAP - height : box.bottom + GAP, left };
}

/** Arrow keys, Home and End move between the items; Tab leaves the menu. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  const index = items.indexOf(document.activeElement as HTMLElement);
  const go = (next: number) => {
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  if (items.length === 0) return;
  if (event.key === 'ArrowDown') go(index + 1);
  else if (event.key === 'ArrowUp') go(index - 1);
  else if (event.key === 'Home') go(0);
  else if (event.key === 'End') go(items.length - 1);
  else if (event.key === 'Tab') close();
}

/**
 * A card's menu on the chart canvas. The cards sit in a zoomed layer, where a fixed panel would zoom with them and
 * lose its place, so the menu opens in the page's body, under the button that opened it: its first item focused,
 * the arrow keys between items, Escape or a click outside closing it (the focus back on its button), an item picked
 * closing it. The canvas closes it when it pans or zooms.
 */
export function ChartMenu({
  at,
  label,
  onClose,
  children,
}: {
  readonly at: MenuAt;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (panel.current) setStyle(placeBelow(at.trigger, panel.current));
  }, [at]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !at.trigger.contains(target)) close.current();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close.current();
      at.trigger.focus();
    };
    const onResize = () => close.current();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [at]);
  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      style={style}
      onKeyDown={(event) => moveFocus(event, () => close.current())}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[role="menuitem"]')) close.current();
      }}
      className="z-40 w-72 max-w-[calc(100vw-1rem)] rounded-xl bg-surface p-1.5 shadow-float ring-1 ring-line"
    >
      {children}
    </div>,
    document.body,
  );
}
