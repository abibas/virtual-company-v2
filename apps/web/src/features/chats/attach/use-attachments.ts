import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fitImage } from './fit-image.ts';
import { ATTACH_REFUSALS, AttachError, CHAT_IMAGES_MAX, draggingFiles, filesOf } from './image-files.ts';

/**
 * The images attached to the message being written (T-18): dropped on the composer's card or pasted in its text,
 * checked and made to fit (`fit-image.ts`), each shown from an object URL that is revoked once it is removed, sent or
 * the composer goes. Refusals are one line of words; nothing dropped ever leaves the page.
 */

export interface Attachment {
  readonly id: string;
  readonly blob: Blob;
  /** An object URL of `blob`, for its chip. */
  readonly url: string;
  readonly name: string;
}

let lastId = 0;

/** Why an attach was refused, in words. */
const refusalOf = (failure: unknown): string =>
  failure instanceof AttachError ? failure.message : ATTACH_REFUSALS.unreadable;

export interface Attachments {
  readonly items: readonly Attachment[];
  /** How many are still being prepared (a large one scaled down): Send waits for them. */
  readonly preparing: number;
  /** The last refusal, cleared by the next attach, a removal or a send. */
  readonly error: string | undefined;
  /** A drag with files is over the drop zone. */
  readonly dragging: boolean;
  remove(id: string): void;
  /** Forgets those that were sent (any attached meanwhile stay). */
  clear(sent: readonly Attachment[]): void;
  /** Forgets the last refusal (a send is tried). */
  dismiss(): void;
  /** On the drop zone (the composer's card). */
  readonly dropZone: {
    onDragEnter(event: DragEvent): void;
    onDragOver(event: DragEvent): void;
    onDragLeave(event: DragEvent): void;
    onDrop(event: DragEvent): void;
  };
  /** On the text box: files on the clipboard are attached instead of pasted (not a document's rich text). */
  onPaste(event: ClipboardEvent): void;
}

/** The attached images; `refused` (a Slack target) refuses every attach with its words. */
export function useAttachments(refused?: string): Attachments {
  const [items, setItems] = useState<readonly Attachment[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  // What counts against the limit: the attached ones and those still being prepared, read between renders.
  const taken = useRef(0);
  const current = useRef(items);
  current.current = items;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const item of current.current) URL.revokeObjectURL(item.url);
    };
  }, []);

  const prepare = useCallback(async (file: File) => {
    setPreparing((n) => n + 1);
    try {
      const blob = await fitImage(file);
      if (!alive.current) return;
      const attachment = { id: `a${++lastId}`, blob, url: URL.createObjectURL(blob), name: file.name };
      setItems((now) => [...now, attachment]);
    } catch (failure) {
      taken.current -= 1;
      if (alive.current) setError(refusalOf(failure));
    } finally {
      if (alive.current) setPreparing((n) => n - 1);
    }
  }, []);

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      if (refused) {
        setError(refused);
        return;
      }
      setError(undefined);
      const room = CHAT_IMAGES_MAX - taken.current;
      if (files.length > room) setError(ATTACH_REFUSALS.count);
      for (const file of files.slice(0, Math.max(0, room))) {
        taken.current += 1;
        void prepare(file);
      }
    },
    [refused, prepare],
  );

  /** Forgets those of `gone` still attached, revoking their URLs. */
  const forget = useCallback((gone: readonly Attachment[]) => {
    const ids = new Set(gone.map((item) => item.id));
    const dropped = current.current.filter((item) => ids.has(item.id));
    for (const item of dropped) URL.revokeObjectURL(item.url);
    taken.current -= dropped.length;
    setError(undefined);
    setItems((now) => now.filter((item) => !ids.has(item.id)));
  }, []);
  const remove = useCallback(
    (id: string) => forget(current.current.filter((item) => item.id === id)),
    [forget],
  );

  const dropZone = useMemo(
    () => ({
      onDragEnter(event: DragEvent) {
        if (!draggingFiles(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        // A refusing composer takes the drop only to say why.
        if (!refused) setDragging(true);
      },
      onDragOver(event: DragEvent) {
        if (!draggingFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave(event: DragEvent) {
        if (!draggingFiles(event.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop(event: DragEvent) {
        if (!draggingFiles(event.dataTransfer)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        add(filesOf(event.dataTransfer));
      },
    }),
    [add, refused],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      const files = filesOf(clipboard);
      // Rich text from a document (Word, Excel, Numbers) comes with a picture of itself: the text is what was meant.
      if (files.length === 0 || clipboard.types.includes('text/rtf')) return;
      // A Slack target pastes the words of a copied file; only an image alone is refused in words.
      if (refused && clipboard.types.includes('text/plain')) return;
      event.preventDefault();
      add(files);
    },
    [add, refused],
  );

  const dismiss = useCallback(() => setError(undefined), []);
  return { items, preparing, error, dragging, remove, clear: forget, dismiss, dropZone, onPaste };
}
