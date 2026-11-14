import { X } from 'lucide-react';
import { cx } from '../../../components/cx.ts';
import { Spinner } from '../../../components/ui/Button.tsx';
import type { Attachment } from './use-attachments.ts';

const CHIP = 'relative size-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-line ring-inset';

/**
 * The images attached to the message being written, above its text inside the composer's card (T-18): a square
 * thumbnail each with a round × at its corner that removes it, and a spinner for each one still being prepared.
 * `muted` (a Slack target): they wait for a message to the agent.
 */
export function AttachmentChips({
  items,
  preparing,
  muted = false,
  onRemove,
}: {
  readonly items: readonly Attachment[];
  readonly preparing: number;
  readonly muted?: boolean;
  readonly onRemove: (id: string) => void;
}) {
  if (items.length === 0 && preparing === 0) return null;
  return (
    <ul
      aria-label="Attached images"
      className={cx('flex flex-wrap gap-2 px-3.5 pt-3', muted && 'opacity-50')}
    >
      {items.map((item, index) => (
        <li key={item.id} className={cx(CHIP, 'group/chip bg-surface-2')}>
          <img src={item.url} alt={item.name || `Image ${index + 1}`} className="size-full object-cover" />
          <button
            type="button"
            aria-label={`Remove ${item.name || `image ${index + 1}`}`}
            title="Remove"
            onClick={() => onRemove(item.id)}
            className="absolute top-1 right-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-full bg-ink/70 text-surface shadow-raised transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-blue"
          >
            <X size={12} strokeWidth={2.75} aria-hidden="true" />
          </button>
        </li>
      ))}
      {Array.from({ length: preparing }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the placeholders are alike and only their count changes.
        <li key={index} className={cx(CHIP, 'flex items-center justify-center bg-surface-2 text-dim')}>
          <Spinner size={18} />
          <span className="sr-only">Preparing an image…</span>
        </li>
      ))}
    </ul>
  );
}
