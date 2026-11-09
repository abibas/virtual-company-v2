import { cx } from '../../../components/cx.ts';
import type { ConversationView } from './context-state.ts';
import { type Fullness, fullness, short } from './context-text.ts';

/** The conversation's own part of the bar, in the meter's tone: green with room, amber filling up, red near full. */
export const TONE_FILL: Readonly<Record<Fullness, string>> = {
  room: 'bg-done',
  filling: 'bg-input',
  full: 'bg-failed',
};

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly tokens: number;
  readonly swatch: string;
}

/** The parts of the window: what the conversation began with, what it added since, and what is left. */
function segmentsOf(view: ConversationView): readonly Segment[] {
  const used = view.used ?? 0;
  const base = view.base && view.base.tokens <= used ? view.base : undefined;
  const parts: Segment[] = [];
  if (base) {
    const compacted = base.after === 'compaction';
    parts.push({
      key: 'base',
      label: compacted ? 'After the last compaction' : 'At the start',
      hint: compacted
        ? 'The system prompt, tools, instructions and the summary'
        : 'The system prompt, tools, instructions and the first message',
      tokens: base.tokens,
      swatch: 'bg-ink-2/55',
    });
  }
  parts.push({
    key: 'since',
    label: base ? 'The conversation since' : 'The conversation',
    hint: 'Messages, replies, tool calls and their results',
    tokens: used - (base?.tokens ?? 0),
    swatch: TONE_FILL[fullness(view.percent)],
  });
  if (view.window)
    parts.push({
      key: 'free',
      label: 'Free',
      hint: 'Room left before the window is full',
      tokens: Math.max(0, view.window - used),
      swatch: 'bg-surface-3 ring-1 ring-line-2 ring-inset',
    });
  return parts;
}

/**
 * "What fills it": the window as one segmented bar (where the conversation began, what it added, what is free) and a
 * legend with each part's size. Without a known window the bar is left out and the legend stands alone.
 */
export function ContextFills({ view }: { readonly view: ConversationView }) {
  if (view.used === undefined)
    return <p className="text-sm text-dim">Its size shows after the agent's next reply.</p>;
  const segments = segmentsOf(view);
  const total = view.window ?? 0;
  return (
    <div className="grid gap-2.5">
      {total > 0 && (
        <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-3">
          {segments
            .filter((segment) => segment.key !== 'free' && segment.tokens > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className={cx(
                  'h-full first:rounded-l-full transition-[width] duration-500 motion-reduce:transition-none',
                  segment.swatch,
                )}
                style={{ width: `${(segment.tokens / total) * 100}%`, minWidth: '0.25rem' }}
              />
            ))}
        </div>
      )}
      <dl className="grid gap-1">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2 text-sm" title={segment.hint}>
            <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-[3px]', segment.swatch)} />
            <dt className="min-w-0 flex-1 truncate text-ink-2">{segment.label}</dt>
            <dd className="tabular font-semibold text-ink">{short(segment.tokens)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
