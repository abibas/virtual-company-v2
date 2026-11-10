import { Brain } from 'lucide-react';
import { roundedDuration } from '../model/format.ts';
import { ACTIVITY_ROW, Disclosure } from './Disclosure.tsx';

/** How the row names a thought: live, short, or how long it took. */
function thoughtWords(ms: number | undefined, live: boolean): string {
  if (ms === undefined) return live ? 'Thinking…' : 'Thought for a moment';
  return ms < 2000 ? 'Thought for a moment' : `Thought for ${roundedDuration(ms)}`;
}

/** The agent's thinking (S5.2): a quiet folded row, opening to the text in a soft muted panel. */
export function Thinking({
  text,
  ms,
  live,
}: {
  readonly text: string;
  readonly ms: number | undefined;
  /** The turn runs and nothing came after this thought yet. */
  readonly live: boolean;
}) {
  const thinkingNow = live && ms === undefined;
  return (
    <Disclosure
      buttonClassName={ACTIVITY_ROW}
      summary={
        <span className="flex min-w-0 items-center gap-2">
          <Brain size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <span className={thinkingNow ? 'text-shimmer motion-safe:animate-shimmer' : undefined}>
            {thoughtWords(ms, live)}
          </span>
        </span>
      }
    >
      <p className="my-1.5 ml-1.5 border-l-2 border-line-2 py-0.5 pl-3.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-dim">
        {text}
      </p>
    </Disclosure>
  );
}
