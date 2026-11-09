import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from '../../../components/forms/Menu.tsx';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside `panel`, in order. */
const focusables = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));

/**
 * A popover that holds the focus while it is open: opening moves focus into the panel, Tab and Shift+Tab cycle
 * inside it, Escape or a click outside closes it with focus back on its trigger.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, trigger);
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);
  const trap = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || panel.current === null) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);
  return { open, setOpen, close, root, trigger, panel, trap };
}
