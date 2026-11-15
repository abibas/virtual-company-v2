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
 * checked and made to fit (`fit-image.ts`). Since T-20 each has a number from the moment it is dropped, its `[Image N]`
 * marker put in the text at the cursor (`MarkerText`, `use-marked-text.ts`): a chip removed takes its marker out, and an
 * image refused while it was prepared too. Refusals are one line of words; nothing dropped ever leaves the page.
 */

export interface Attachment {
  readonly id: string;
  /** Its number: the `[Image N]` marker in the text and the chip's label. */
  readonly n: number;
  readonly name: string;
  /** The image as it goes with the message; none while it is being prepared (a large one scaled down). */
  readonly blob?: Blob | undefined;
}

/** How the attachments reach the text: their markers put in at the cursor, taken out, and those already in it. */
export interface MarkerText {
  put(numbers: readonly number[]): void;
  take(n: number): void;
  /** The numbers of the markers in the text (a typed one too): a new image's number comes after them. */
  inText(): readonly number[];
}

let lastId = 0;

/** Why an attach was refused, in words. */
const refusalOf = (failure: unknown): string =>
  failure instanceof AttachError ? failure.message : ATTACH_REFUSALS.unreadable;

export interface Attachments {
  /** In the order they were attached, those still being prepared too. */
  readonly items: readonly Attachment[];
  /** How many are still being prepared: Send waits for them. */
  readonly preparing: number;
  /** The last refusal, cleared by the next attach, a removal or a send. */
  readonly error: string | undefined;
  /** A drag with files is over the drop zone. */
  readonly dragging: boolean;
  /** Removes it and its marker (its chip's ×). */
  remove(id: string): void;
  /** Forgets these, their markers left as they are (gone from the text already). */
  forget(ids: readonly string[]): void;
  /** Forgets those that were sent; any attached meanwhile are numbered from 1 again, their numbers returned. */
  sent(ids: readonly string[]): readonly number[];
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

/** The attached images, their markers in `markers`; `refused` (a Slack target) refuses every attach with its words. */
export function useAttachments(markers: MarkerText, refused?: string): Attachments {
  // The list as it is now, read and changed between renders (two drops before a render count both).
  const list = useRef<readonly Attachment[]>([]);
  const [items, setItems] = useState(list.current);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const commit = useCallback((next: readonly Attachment[]) => {
    list.current = next;
    setItems(next);
  }, []);

  const prepare = useCallback(
    async (id: string, file: File) => {
      try {
        const blob = await fitImage(file);
        if (!alive.current) return;
        commit(list.current.map((item) => (item.id === id ? { ...item, blob } : item)));
      } catch (failure) {
        if (!alive.current) return;
        const item = list.current.find((one) => one.id === id);
        if (item) {
          commit(list.current.filter((one) => one.id !== id));
          markers.take(item.n);
        }
        setError(refusalOf(failure));
      }
    },
    [commit, markers],
  );

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      if (refused) {
        setError(refused);
        return;
      }
      const room = CHAT_IMAGES_MAX - list.current.length;
      setError(files.length > room ? ATTACH_REFUSALS.count : undefined);
      const taken = files.slice(0, Math.max(0, room));
      if (taken.length === 0) return;
      let n = Math.max(0, ...list.current.map((item) => item.n), ...markers.inText());
      const added = taken.map((file) => ({ id: `a${++lastId}`, n: ++n, name: file.name }));
      commit([...list.current, ...added]);
      markers.put(added.map((item) => item.n));
      added.forEach((item, index) => void prepare(item.id, taken[index] as File));
    },
    [refused, prepare, commit, markers],
  );

  const forget = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      if (!list.current.some((item) => gone.has(item.id))) return;
      setError(undefined);
      commit(list.current.filter((item) => !gone.has(item.id)));
    },
    [commit],
  );
  const remove = useCallback(
    (id: string) => {
      const item = list.current.find((one) => one.id === id);
      if (item === undefined) return;
      forget([id]);
      markers.take(item.n);
    },
    [forget, markers],
  );
  const sent = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      const rest = list.current
        .filter((item) => !gone.has(item.id))
        .map((item, index) => ({ ...item, n: index + 1 }));
      commit(rest);
      return rest.map((item) => item.n);
    },
    [commit],
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
  const preparing = items.filter((item) => item.blob === undefined).length;
  return { items, preparing, error, dragging, remove, forget, sent, dismiss, dropZone, onPaste };
}
