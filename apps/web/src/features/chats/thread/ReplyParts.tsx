import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../components/cx.ts';
import { SENT_NOW_NOTE } from '../delivery/delivery.ts';
import { Thinking } from './activity/Thinking.tsx';
import { ToolGroup } from './activity/ToolGroup.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import type { Part, TurnModel } from './model/parts.ts';
import { SubagentBlock } from './subagents/SubagentBlock.tsx';
import { CompactedMarker } from './TurnMarkers.tsx';

/** A message the person sent into the running turn, where the agent took it (S5.2 step 6). */
function TakenMessage({ text }: { readonly text: string }) {
  return (
    <div className="grid justify-items-end gap-1 py-1">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-soft px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-ink ring-1 ring-blue/25 ring-inset">
        {text}
      </p>
      <span className="text-2xs text-dim">{SENT_NOW_NOTE}</span>
    </div>
  );
}

/**
 * A list of a turn's parts (S5.2): the main reply, or a subagent's own steps inside its block (the same renderer,
 * passed down so the blocks nest without an import cycle). Text is Markdown; tools, thinking and notices are quiet
 * rows; subagents are blocks. `live`: the list is still growing (its turn or subagent runs).
 */
export function ReplyParts({
  parts,
  model,
  live,
}: {
  readonly parts: readonly Part[];
  readonly model: TurnModel;
  readonly live: boolean;
}) {
  const render = (list: readonly Part[], growing: boolean): ReactNode =>
    list.map((part, index) => {
      const last = index === list.length - 1;
      if (part.kind === 'text') return <Markdown key={part.key} text={part.text} />;
      if (part.kind === 'thinking')
        return <Thinking key={part.key} text={part.text} ms={part.ms} live={growing && last} />;
      if (part.kind === 'tools') return <ToolGroup key={part.key} calls={part.calls} running={growing} />;
      if (part.kind === 'compact') return <CompactedMarker key={part.key} event={part.event} />;
      if (part.kind === 'input') return <TakenMessage key={part.key} text={part.text} />;
      if (part.kind === 'subagent') {
        const state = model.subagents.get(part.id);
        if (state === undefined) return null;
        return (
          <SubagentBlock
            key={part.key}
            state={state}
            parts={model.children.get(part.id) ?? []}
            renderParts={render}
          />
        );
      }
      return (
        <p
          key={part.key}
          className={cx(
            'flex items-start gap-1.5 px-2 text-xs',
            part.level === 'warn' ? 'text-input' : 'text-dim',
          )}
        >
          <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{part.message}</span>
        </p>
      );
    });
  return <>{render(parts, live)}</>;
}
