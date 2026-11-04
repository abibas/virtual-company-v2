import { X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';

/**
 * While the drawer is open: focus moves into it, Escape closes it, the page behind does not scroll, and focus
 * goes back to where it was once it closes.
 */
function useOpenDrawer(open: boolean, onClose: () => void, panel: RefObject<HTMLDivElement | null>) {
  const before = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before.current instanceof HTMLElement) before.current.focus();
    };
  }, [open, onClose, panel]);
}

/** A panel that slides in from the right over a dimmed page (the attention feed on narrow screens). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useOpenDrawer(open, onClose, panel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cx(
          'relative m-2 flex w-[min(100vw-1rem,400px)] flex-col rounded-2xl bg-surface p-4 shadow-float outline-none',
          className,
        )}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id={id} className="text-xs font-semibold text-dim">
            {title}
          </h2>
          <IconButton label="Close" icon={X} size="sm" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
