import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../../../components/cx.ts';
import { Spinner } from '../../../components/ui/Button.tsx';
import type { Attachment } from './use-attachments.ts';

/**
 * The images attached to the message being written, above its text inside the composer's card (T-18): a thumbnail each
 * at the image's own shape, labeled "Image N" as its marker in the text (T-20), with a round × at its corner that
 * removes it and its marker, and a spinner while it is being prepared. `muted` (a Slack target): they wait for a
 * message to the agent.
 */

/** An object URL of the blob while the chip shows it: made by the chip itself, so a remount never shows a revoked one. */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (blob === undefined) return;
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return blob === undefined ? undefined : url;
}

function Chip({ item, onRemove }: { readonly item: Attachment; readonly onRemove: (id: string) => void }) {
  const url = useObjectUrl(item.blob);
  const label = `Image ${item.n}`;
  return (
    <li
      title={item.name || label}
      className="relative h-16 shrink-0 overflow-hidden rounded-xl bg-surface-2 after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:ring-1 after:ring-line after:ring-inset after:content-['']"
    >
      {url ? (
        <img src={url} alt={label} className="block h-16 w-auto max-w-32 min-w-12 object-cover" />
      ) : (
        <span className="flex size-16 items-center justify-center text-dim">
          <Spinner size={18} />
          <span className="sr-only">Preparing {label}…</span>
        </span>
      )}
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 rounded-md bg-ink/70 px-1.5 py-px text-2xs leading-4 font-medium text-surface"
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title="Remove"
        onClick={() => onRemove(item.id)}
        className="absolute top-1 right-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-full bg-ink/70 text-surface shadow-raised transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-blue"
      >
        <X size={12} strokeWidth={2.75} aria-hidden="true" />
      </button>
    </li>
  );
}

export function AttachmentChips({
  items,
  muted = false,
  onRemove,
}: {
  readonly items: readonly Attachment[];
  readonly muted?: boolean;
  readonly onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label="Attached images"
      className={cx('flex flex-wrap gap-2 px-3.5 pt-3', muted && 'opacity-50')}
    >
      {items.map((item) => (
        <Chip key={item.id} item={item} onRemove={onRemove} />
      ))}
    </ul>
  );
}
