import { useEffect, useRef } from 'react';

/**
 * Dictation's keys: Alt+Shift+V stops the composer that is recording wherever the focus is, else starts the composer
 * with the focus (when no other one holds the microphone); Esc stops a recording.
 */
export function useDictationKeys(keys: {
  readonly getRoot: () => HTMLElement | null;
  readonly toggle: () => Promise<void>;
  /** This composer is recording. */
  readonly recording: () => boolean;
  /** Another composer holds the microphone. */
  readonly elsewhere: () => boolean;
}) {
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { getRoot, toggle, recording, elsewhere } = keysRef.current;
      if (event.key === 'Escape' && recording()) {
        event.preventDefault();
        void toggle();
        return;
      }
      const shortcut =
        event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyV';
      if (!shortcut) return;
      if (!recording() && (elsewhere() || !getRoot()?.contains(event.target as Node))) return;
      event.preventDefault();
      event.stopPropagation();
      void toggle();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
