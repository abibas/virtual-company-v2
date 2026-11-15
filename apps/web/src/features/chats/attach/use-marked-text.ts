import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  insertMarkers,
  keepMarkersWhole,
  markerOrder,
  markersIn,
  renumbered,
  withoutMarker,
} from './markers.ts';
import { type Attachment, type Attachments, type MarkerText, useAttachments } from './use-attachments.ts';

/**
 * The composer's text and its images, linked by their `[Image N]` markers (T-20): a dropped or pasted image puts its
 * marker in at the cursor (or over the selection), a chip removed takes its marker out, and a marker deleted from the
 * text (typed, cut or dictated over) forgets its image. A send carries the text with its markers numbered 1, 2, … in
 * the order they appear and the images in that order, so "[Image 2]" is the second image the agent gets.
 */

export interface MarkedText {
  readonly text: string;
  readonly attach: Attachments;
  /** On the message box: where markers go in, and its caret after one does. */
  readonly box: RefObject<HTMLTextAreaElement | null>;
  /** A change of the text typed, cut, pasted or dictated. */
  change(next: string): void;
  /** The text as it is now, with a change made since the last render (dictated words put in before a send, T-32). */
  now(): string;
  /** What a send carries: the text with its markers numbered from 1 and those images in that order. */
  outgoing(attached: readonly Attachment[]): { readonly prompt: string; readonly images: readonly Blob[] };
  /** After a send: the text emptied and those images forgotten (one attached meanwhile keeps its marker, from 1). */
  sent(attached: readonly Attachment[]): void;
}

export function useMarkedText(refused?: string): MarkedText {
  const [text, setText] = useState('');
  // The text as it is now, read between renders (a marker put in right after another).
  const latest = useRef(text);
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | undefined>(undefined);
  const write = useCallback((next: string, at?: number) => {
    latest.current = next;
    caret.current = at;
    setText(next);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caret is put back after each new text is drawn.
  useLayoutEffect(() => {
    const at = caret.current;
    const element = box.current;
    if (at === undefined || element === null) return;
    caret.current = undefined;
    element.focus();
    element.setSelectionRange(at, at);
  }, [text]);

  const markers = useMemo<MarkerText>(
    () => ({
      put(numbers) {
        const element = box.current;
        const now = latest.current;
        const start = element?.selectionStart ?? now.length;
        const out = insertMarkers(now, start, element?.selectionEnd ?? start, numbers);
        write(out.text, out.caret);
      },
      take(n) {
        const element = box.current;
        // The caret stays where it was in a box being written in; a box elsewhere is left unfocused.
        const focused = element !== null && document.activeElement === element;
        const out = withoutMarker(latest.current, n, focused ? element.selectionStart : undefined);
        write(out.text, focused ? out.caret : undefined);
      },
      inText: () => markersIn(latest.current).map((marker) => marker.n),
    }),
    [write],
  );

  const attach = useAttachments(markers, refused);
  const items = useRef(attach.items);
  items.current = attach.items;
  const { forget } = attach;

  const change = useCallback(
    (next: string) => {
      const kept = keepMarkersWhole(latest.current, next);
      const result = kept?.text ?? next;
      write(result, kept?.caret);
      const left = new Set(markerOrder(result));
      const gone = items.current.filter((item) => !left.has(item.n));
      if (gone.length > 0) forget(gone.map((item) => item.id));
    },
    [write, forget],
  );

  const now = useCallback(() => latest.current, []);

  const outgoing = (attached: readonly Attachment[]) => {
    const order = markerOrder(latest.current);
    const rank = (n: number) => {
      const at = order.indexOf(n);
      return at === -1 ? order.length : at;
    };
    const sorted = [...attached].sort((a, b) => rank(a.n) - rank(b.n));
    return {
      prompt: renumbered(
        latest.current,
        sorted.map((item) => item.n),
      ),
      images: sorted.flatMap((item) => (item.blob ? [item.blob] : [])),
    };
  };

  const sent = (attached: readonly Attachment[]) => {
    const left = attach.sent(attached.map((item) => item.id));
    write(left.length > 0 ? insertMarkers('', 0, 0, left).text : '');
  };

  return { text, attach, box, change, now, outgoing, sent };
}
