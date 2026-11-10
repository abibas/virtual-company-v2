import type { ReactNode } from 'react';
import { cx } from '../../../../components/cx.ts';
import { CopyAction } from '../markdown/CopyAction.tsx';

/**
 * Shows a message's actions while the message is hovered or one of them has the keyboard focus; always on screens
 * without hover (touch). The message's element carries `group/message`.
 */
export const REVEAL_ACTIONS =
  'opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100';

/**
 * The quiet actions under a message (the person's and the agent's): Copy, which puts the message's text (the agent's
 * Markdown as written) on the clipboard with a "Copied" tick. `more` is the slot for the actions after Copy: the next
 * step puts Branch ("continue a new chat from here") there, so every message gets it in the same place.
 */
export function MessageActions({
  text,
  label,
  more,
  className,
}: {
  /** What Copy puts on the clipboard. */
  readonly text: string;
  /** What Copy copies, for screen readers and the tooltip ("Copy message", "Copy reply"). */
  readonly label: string;
  /** Further actions after Copy (the Branch slot); nothing for now. */
  readonly more?: ReactNode;
  readonly className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a form's fieldset.
    <div role="group" aria-label="Message actions" className={cx('flex items-center gap-0.5', className)}>
      <CopyAction text={text} label={label} size="md" />
      {more}
    </div>
  );
}
