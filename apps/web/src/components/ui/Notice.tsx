import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Readonly<
  Record<NoticeTone, { readonly frame: string; readonly icon: LucideIcon; readonly mark: string }>
> = {
  info: { frame: 'bg-blue-soft text-ink', icon: Info, mark: 'text-blue' },
  success: { frame: 'bg-done-soft text-ink', icon: CircleCheck, mark: 'text-done' },
  warning: { frame: 'bg-input-soft text-ink', icon: TriangleAlert, mark: 'text-input' },
  error: { frame: 'bg-failed-soft text-ink', icon: CircleAlert, mark: 'text-failed' },
};

/** An inline message about the last action or the page's state; errors are announced at once. */
export function Notice({
  tone = 'info',
  title,
  action,
  onDismiss,
  children,
}: {
  readonly tone?: NoticeTone;
  readonly title?: string;
  /** A button or link on the right. */
  readonly action?: ReactNode;
  readonly onDismiss?: () => void;
  readonly children: ReactNode;
}) {
  const { frame, icon: Icon, mark } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-xl px-4 py-3 text-sm', frame)}
    >
      <Icon size={18} strokeWidth={2.25} aria-hidden="true" className={cx('mt-0.5 shrink-0', mark)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        <div className={cx(title && 'mt-0.5 text-ink-2')}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-mr-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-ink/8 hover:text-ink"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
