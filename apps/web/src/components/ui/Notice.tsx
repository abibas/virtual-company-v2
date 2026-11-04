import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Readonly<Record<NoticeTone, string>> = {
  info: 'border-info/40 text-ink-2',
  success: 'border-pulse/45 bg-pulse-soft text-ink',
  warning: 'border-amber/45 bg-amber-soft text-ink',
  error: 'border-alarm/45 bg-alarm-soft text-ink',
};

const MARKS: Readonly<Record<NoticeTone, string>> = {
  info: 'bg-info',
  success: 'bg-pulse',
  warning: 'bg-amber',
  error: 'bg-alarm',
};

/** An inline message about the last action or the page's state; errors are announced at once. */
export function Notice({
  tone = 'info',
  children,
}: {
  readonly tone?: NoticeTone;
  readonly children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-[13.5px] ${TONES[tone]}`}
    >
      <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 rounded-full ${MARKS[tone]}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
