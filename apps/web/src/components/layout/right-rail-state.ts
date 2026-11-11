import { useCallback, useState, useSyncExternalStore } from 'react';

/** The right rail is in view from Tailwind's `xl` breakpoint; below it the top bar's inbox button opens it as a drawer. */
const WIDE = '(min-width: 80rem)';

/** Where the person's own choice is kept, in this browser only. */
const KEY = 'mwc.rightRail';

type Choice = 'expanded' | 'collapsed';

function readChoice(): Choice | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'expanded' || value === 'collapsed' ? value : null;
  } catch {
    return null;
  }
}

function writeChoice(choice: Choice): void {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked (a private window): the choice holds for this page only.
  }
}

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True from 80rem up, where the right rail shows beside the page; follows the window as it is resized. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches);
}

export interface RightRailState {
  /** The card is open; else the rail is the slim strip at the right edge. */
  readonly open: boolean;
  /** Opens or collapses the rail and remembers it as the person's choice. */
  setOpen(open: boolean): void;
}

/**
 * Whether the wide-screen right rail is open: open while something needs the person and collapsed while nothing
 * does, until they toggle it; from then on their choice holds (`mwc.rightRail`), and new items only make the strip's
 * count pulse.
 */
export function useRightRail(attentionCount: number): RightRailState {
  const [choice, setChoice] = useState<Choice | null>(readChoice);
  const setOpen = useCallback((open: boolean) => {
    const next: Choice = open ? 'expanded' : 'collapsed';
    writeChoice(next);
    setChoice(next);
  }, []);
  return { open: choice === null ? attentionCount > 0 : choice === 'expanded', setOpen };
}
