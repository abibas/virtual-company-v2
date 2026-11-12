import { cx } from '../../../components/cx.ts';
import { MessageAuthor } from '../../../components/feed/MessageAuthor.tsx';
import type { Prompter } from './authors.ts';
import { MessageActions, REVEAL_ACTIONS } from './status/MessageActions.tsx';

/**
 * A turn's prompt under its author: the reader's own on the right in a soft blue bubble, their face beside their name;
 * another person's or agent's on the left in a neutral bubble; one Most Wanted queued itself (S6c: a Lead's wake-up) on
 * the left with its mark, as a quiet notice in smaller type. Its delivery note and Copy follow it.
 */
export function PromptMessage({
  prompt,
  prompter,
  at,
  note,
  dense,
}: {
  readonly prompt: string;
  readonly prompter: Prompter;
  readonly at: string;
  readonly note: string | undefined;
  readonly dense: boolean;
}) {
  const { author, own } = prompter;
  const system = author.kind === 'system';
  return (
    <MessageAuthor
      author={author}
      at={at}
      side={own ? 'end' : 'start'}
      dense={dense}
      className="group/message"
    >
      <p
        className={cx(
          'max-w-full break-words whitespace-pre-wrap',
          system
            ? cx(
                'justify-self-start rounded-lg bg-surface-2 px-3 py-2 leading-relaxed text-ink-2',
                dense ? 'text-xs' : 'text-[0.8125rem]',
              )
            : 'rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-relaxed text-ink',
          !system && (dense ? 'sm:max-w-[92%]' : 'sm:max-w-[85%]'),
          !system && (own ? 'rounded-tr-md bg-blue-soft' : 'justify-self-start rounded-tl-md bg-surface-2'),
        )}
      >
        {prompt}
      </p>
      <div className="flex min-h-7 items-center gap-2">
        {note && <span className="text-2xs text-dim">{note}</span>}
        <MessageActions text={prompt} label="Copy message" className={REVEAL_ACTIONS} />
      </div>
    </MessageAuthor>
  );
}
