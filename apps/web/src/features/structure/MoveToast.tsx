import { CircleAlert, CircleCheck, Undo2, X } from 'lucide-react';
import { useEffect } from 'react';
import { cx } from '../../components/cx.ts';
import { Button } from '../../components/ui/Button.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import type { MoveNotice } from './use-chart-moves.ts';

/** How long a move's sentence stays, and a refusal's (longer: it is read, not glanced at). */
const SHOWN_MS = { success: 7000, error: 12000 } as const;

/**
 * The sentence of the last move, at the bottom of the canvas: "Moved Vega under Ihor Herasko · Undo", or the server's
 * refusal. It goes by itself after a while, or with ×; announced politely (a refusal at once).
 */
export function MoveToast({
  notice,
  onDismiss,
}: {
  readonly notice: MoveNotice | undefined;
  readonly onDismiss: () => void;
}) {
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, SHOWN_MS[notice.tone]);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  const error = notice.tone === 'error';
  const Icon = error ? CircleAlert : CircleCheck;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-surface py-2 pr-2 pl-3.5 text-sm font-medium text-ink shadow-float ring-1 ring-line"
    >
      <Icon size={17} aria-hidden="true" className={cx('shrink-0', error ? 'text-failed' : 'text-done')} />
      <span className="min-w-0">{notice.text}</span>
      {notice.undo && (
        <Button
          size="sm"
          tone="soft"
          icon={Undo2}
          onClick={() => {
            onDismiss();
            notice.undo?.();
          }}
        >
          Undo
        </Button>
      )}
      <IconButton label="Dismiss" icon={X} size="sm" onClick={onDismiss} />
    </div>
  );
}
