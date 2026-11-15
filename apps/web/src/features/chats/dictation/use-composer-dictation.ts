import { type RefObject, useCallback } from 'react';
import { type Dictation, useDictation } from './use-dictation.ts';

/**
 * The composer's dictation (T-32: held by the Composer, so its Send can stop a recording and wait for its words): the
 * dictated text goes in at the cursor of the message box, and Alt+Shift+V counts in the box's form.
 */

/** The text with a space before and after it where its neighbours need one. */
function spliced(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const trail = after !== '' && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
  return {
    next: `${before}${lead}${text}${trail}${after}`,
    caret: before.length + lead.length + text.length,
  };
}

export function useComposerDictation(message: {
  /** The message box. */
  readonly box: RefObject<HTMLTextAreaElement | null>;
  /** Its text as it is now (read after the transcription, not from the render that started it). */
  readonly now: () => string;
  readonly onChange: (next: string) => void;
}): Dictation {
  const { box, now, onChange } = message;
  const getRoot = useCallback(() => box.current?.closest('form') ?? null, [box]);
  const insert = useCallback(
    (text: string) => {
      const element = box.current;
      const current = now();
      const start = element?.selectionStart ?? current.length;
      const { next, caret } = spliced(current, start, element?.selectionEnd ?? start, text);
      const max = element !== null && element.maxLength > 0 ? element.maxLength : next.length;
      onChange(next.slice(0, max));
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(Math.min(caret, max), Math.min(caret, max));
      });
    },
    [box, now, onChange],
  );
  return useDictation({ getRoot, insert });
}
