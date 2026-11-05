import { X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';

/**
 * While a drawer or a sheet is open: focus moves into it, Escape closes it, the page behind does not scroll, and focus
 * goes back to where it was once it closes. A new `onClose` on each render does not move the focus again.
 */
function useOpenDrawer(open: boolean, onClose: () => void, panel: RefObject<HTMLDivElement | null>) {
  const before = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before.current instanceof HTMLElement) before.current.focus();
    };
  }, [open, panel]);
}

/** The dimmed page behind a drawer or a sheet; a click on it closes. */
function Backdrop({ onClose }: { readonly onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
    />
  );
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
      <Backdrop onClose={onClose} />
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

/**
 * A task done beside the page (add a subscription): a titled dialog over a dimmed page, rising from the bottom on
 * phones and standing at the right from small screens up. Its body scrolls on its own.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useOpenDrawer(open, onClose, panel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end">
      <Backdrop onClose={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-float outline-none sm:m-2 sm:max-h-none sm:w-[min(100vw-1rem,30rem)] sm:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-lg font-bold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && (
              <p id={`${id}-description`} className="mt-0.5 text-sm text-dim">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" icon={X} size="sm" onClick={onClose} className="-mt-1 -mr-1" />
        </header>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
