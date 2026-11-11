import { useState } from 'react';
import type { TaskEvent } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Face } from '../Face.tsx';
import { Clip } from '../story/Clip.tsx';
import { DOT, eventWords } from '../story/outcomes.ts';
import { When } from '../story/StoryStepRow.tsx';
import { isNoise } from '../story/story.ts';

/**
 * A task's full history, oldest first (the page's Log tab): one line per row, its dot in its colour, who did what
 * (their face: an agent's icon when an agent moved it with its tools, S6a) from and to which step, its reason once
 * beside it, clipped, and when. The quiet rows (entered, started by itself, an obvious route) show only when asked.
 */
export function TaskHistory({
  history,
  nodes,
}: {
  readonly history: readonly TaskEvent[];
  readonly nodes: ReadonlyMap<string, ChartNode>;
}) {
  const [noise, setNoise] = useState(false);
  const quiet = history.filter(isNoise).length;
  const shown = noise ? history : history.filter((event) => !isNoise(event));
  return (
    <div className="grid gap-2">
      {quiet > 0 && (
        <div className="flex justify-end">
          <Switch
            checked={noise}
            onChange={setNoise}
            label={`Quiet rows (${quiet})`}
            className="text-xs text-dim"
          />
        </div>
      )}
      <ol className="grid">
        {shown.map((event) => (
          <li
            key={event.id}
            className="flex min-h-7 min-w-0 items-center gap-2 border-b border-line/60 py-1 last:border-0"
          >
            <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', DOT[event.kind])} />
            {event.actor && <Face who={event.actor} nodes={nodes} size="xs" className="max-sm:hidden" />}
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className={cx('min-w-0 text-xs', isNoise(event) ? 'text-dim' : 'font-medium text-ink')}>
                {eventWords(event)}
              </span>
              {event.reason && (
                <Clip text={event.reason} className="min-w-[8rem] flex-1 text-xs text-ink-2" />
              )}
            </span>
            <When at={event.at} />
          </li>
        ))}
      </ol>
    </div>
  );
}
