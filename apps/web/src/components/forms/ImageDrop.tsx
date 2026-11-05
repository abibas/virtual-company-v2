import {
  type ComponentPropsWithRef,
  type DragEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';

/** The first image file of a drop or a paste, if any. */
export function imageFileOf(transfer: DataTransfer | null): File | null {
  if (!transfer) return null;
  for (const item of transfer.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  const file = transfer.files[0];
  return file?.type.startsWith('image/') ? file : null;
}

export interface ImageDropProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'type'> {
  /** What choosing an image does, for screen readers ("Add a logo"). */
  readonly label: string;
  readonly onFile: (file: File) => void;
  /** The dashed frame of an empty zone; without it the zone looks like whatever `children` draw. */
  readonly dashed?: boolean;
  /** Also takes an image pasted anywhere on the page, not only on the zone (a page that is one form). */
  readonly pasteAnywhere?: boolean;
  /** The hidden file input, so a button outside the zone can open the file dialog too (`current.click()`). */
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}

const DASHED =
  'border-2 border-dashed border-line-2 bg-surface-2 text-dim hover:border-blue hover:bg-blue-soft hover:text-blue data-dragging:border-blue data-dragging:bg-blue-soft data-dragging:text-blue';
const FILLED =
  'data-dragging:ring-2 data-dragging:ring-blue data-dragging:ring-offset-2 data-dragging:ring-offset-surface';

/** The drag, drop and paste handling of a zone, and the page-wide paste when asked for. */
function useImageZone(onFile: (file: File) => void, disabled: boolean, pasteAnywhere: boolean) {
  const [dragging, setDragging] = useState(false);
  const take = (file: File | null) => {
    if (file && !disabled) onFile(file);
  };
  useEffect(() => {
    if (!pasteAnywhere || disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = imageFileOf(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      onFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteAnywhere, disabled, onFile]);
  const over = (event: DragEvent, inside: boolean) => {
    event.preventDefault();
    if (!disabled) setDragging(inside);
  };
  return {
    dragging,
    take,
    onDragEnter: (event: DragEvent) => over(event, true),
    onDragOver: (event: DragEvent) => over(event, true),
    onDragLeave: (event: DragEvent) => over(event, false),
    onDrop: (event: DragEvent) => {
      over(event, false);
      take(imageFileOf(event.dataTransfer));
    },
    onPaste: (event: ReactClipboardEvent) => {
      const file = imageFileOf(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      take(file);
    },
  };
}

/**
 * A zone that takes one image: a click opens the file dialog, a file can be dropped on it, and an image on the
 * clipboard can be pasted on it. What is inside is the caller's; the zone adds the drop highlight.
 */
export function ImageDrop({
  label,
  onFile,
  dashed = false,
  pasteAnywhere = false,
  inputRef,
  disabled = false,
  className,
  children,
  ...rest
}: ImageDropProps) {
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const { dragging, take, ...handlers } = useImageZone(onFile, disabled, pasteAnywhere);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        data-dragging={dragging || undefined}
        onClick={() => input.current?.click()}
        className={cx(
          'group/drop relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden transition-[background-color,border-color,box-shadow,color] duration-150 disabled:cursor-not-allowed disabled:opacity-60',
          dashed ? DASHED : FILLED,
          className,
        )}
        {...handlers}
        {...rest}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          take(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
    </>
  );
}
