import type { ReactNode } from 'react';
import { cx } from '../../../components/cx.ts';

/**
 * An agent's text, rendered safely (S5.1c): code fences as code blocks (an unclosed fence, while the text streams,
 * runs to the end), `inline code` as code, and every line break kept. Everything is React text, never HTML, so
 * whatever the agent writes shows as it is written.
 */

type Block =
  | { readonly code: false; readonly text: string }
  | { readonly code: true; readonly lang: string; readonly text: string };

const FENCE = /^```([^\n`]*)\n?([\s\S]*?)(?:\n?```|$)/;

/** The text as prose and fenced code, in order. */
export function blocksOf(text: string): readonly Block[] {
  const blocks: Block[] = [];
  let rest = text;
  while (rest.length > 0) {
    const start = rest.search(/(^|\n)```/);
    if (start < 0) {
      blocks.push({ code: false, text: rest });
      break;
    }
    const at = rest[start] === '\n' ? start + 1 : start;
    const prose = rest.slice(0, at).replace(/\n$/, '');
    if (prose) blocks.push({ code: false, text: prose });
    const match = FENCE.exec(rest.slice(at));
    if (!match) {
      blocks.push({ code: false, text: rest.slice(at) });
      break;
    }
    blocks.push({ code: true, lang: (match[1] ?? '').trim(), text: match[2] ?? '' });
    rest = rest.slice(at + match[0].length).replace(/^\n/, '');
  }
  return blocks;
}

/** Prose with `inline code` spans. */
function Prose({ text }: { readonly text: string }) {
  const pieces: ReactNode[] = [];
  const pattern = /`([^`\n]+)`/g;
  let from = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > from) pieces.push(text.slice(from, match.index));
    pieces.push(
      <code key={match.index} className="rounded-xs bg-surface-3 px-1 py-px font-mono text-[0.85em] text-ink">
        {match[1]}
      </code>,
    );
    from = match.index + match[0].length;
  }
  if (from < text.length) pieces.push(text.slice(from));
  return <p className="break-words whitespace-pre-wrap">{pieces}</p>;
}

/** The agent's text: prose and code blocks. */
export function RichText({ text, className }: { readonly text: string; readonly className?: string }) {
  return (
    <div className={cx('grid gap-2 text-sm leading-relaxed text-ink', className)}>
      {blocksOf(text).map((block, index) =>
        block.code ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a block's place in the text is its identity.
          <figure key={index} className="min-w-0">
            {block.lang && (
              <figcaption className="mb-1 font-mono text-2xs text-faint">{block.lang}</figcaption>
            )}
            <pre className="scroll-quiet overflow-x-auto rounded-lg bg-surface-3 px-3 py-2.5 font-mono text-xs leading-normal text-ink">
              <code>{block.text}</code>
            </pre>
          </figure>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a block's place in the text is its identity.
          <Prose key={index} text={block.text} />
        ),
      )}
    </div>
  );
}
