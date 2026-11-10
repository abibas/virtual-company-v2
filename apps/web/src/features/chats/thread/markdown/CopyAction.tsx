import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../../../../components/cx.ts';

/**
 * A small copy button for the thread (S5.2: a code block, a message): an icon, a word when `showText`, a check and
 * "Copied" for two seconds once copied, and a spoken status.
 */
export function CopyAction({
  text,
  label,
  showText = false,
  size = 'sm',
  className,
}: {
  readonly text: string;
  /** What it copies, for screen readers and the tooltip ("Copy code"). */
  readonly label: string;
  readonly showText?: boolean;
  /** `sm` in a code block's caption and a command, `md` under a message. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const Icon = state === 'copied' ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      title={state === 'failed' ? 'Select the text and copy it by hand' : label}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm font-semibold text-dim transition-colors hover:bg-surface-3 hover:text-ink',
        size === 'sm' ? 'h-6 px-1.5 text-2xs' : 'h-7 px-2 text-xs',
        state === 'copied' && 'text-done hover:text-done',
        className,
      )}
    >
      <Icon size={size === 'sm' ? 13 : 14} aria-hidden="true" />
      {state === 'copied' ? <span>Copied</span> : showText && <span>Copy</span>}
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : ''}
      </span>
    </button>
  );
}
