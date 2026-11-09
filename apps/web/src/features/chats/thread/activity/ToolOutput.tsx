import { useState } from 'react';
import { cx } from '../../../../components/cx.ts';

/** How many lines an output shows before "Show more". */
const CLIP_LINES = 8;

/** A tool's input or output in monospace, clipped to a few lines with "Show more" (S5.2). */
export function ToolOutput({
  text,
  failed = false,
  label,
}: {
  readonly text: string;
  readonly failed?: boolean;
  /** What the block is ("Command", "Output"), said quietly above it. */
  readonly label: string;
}) {
  const [all, setAll] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > CLIP_LINES;
  const shown = long && !all ? lines.slice(0, CLIP_LINES).join('\n') : text;
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-2xs font-semibold text-faint">{label}</p>
      <pre
        className={cx(
          'scroll-quiet max-h-80 overflow-auto rounded-md px-2.5 py-2 font-mono text-2xs leading-relaxed break-words whitespace-pre-wrap',
          failed ? 'bg-failed-soft text-ink' : 'bg-surface-2 text-ink-2',
        )}
      >
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="w-fit cursor-pointer rounded-xs text-2xs font-semibold text-blue hover:text-blue-strong"
        >
          {all ? 'Show less' : `Show ${lines.length - CLIP_LINES} more lines`}
        </button>
      )}
    </div>
  );
}
