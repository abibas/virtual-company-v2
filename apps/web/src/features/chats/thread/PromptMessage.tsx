import type { ReactNode } from 'react';
import type { ChatImage } from '../../../api/chat-images.ts';
import { cx } from '../../../components/cx.ts';
import { MessageAuthor } from '../../../components/feed/MessageAuthor.tsx';
import { isImagesPrompt } from '../attach/image-files.ts';
import type { Prompter } from './authors.ts';
import { MessageImages } from './MessageImages.tsx';
import { MessageActions, REVEAL_ACTIONS } from './status/MessageActions.tsx';

/**
 * A turn's prompt under its author: the reader's own on the right in a soft blue bubble, their face beside their name;
 * another person's or agent's on the left in a neutral bubble; one Most Wanted queued itself (S6c: a Lead's wake-up) on
 * the left with its mark, as a quiet notice in smaller type. Its images (T-18) come before the bubble, which a message
 * of images alone leaves out ("(2 images)" is for the agent). Its delivery note and Copy follow it.
 */
export function PromptMessage({
  prompt,
  prompter,
  at,
  note,
  dense,
  extra,
  images,
}: {
  readonly prompt: string;
  readonly prompter: Prompter;
  readonly at: string;
  readonly note: string | undefined;
  readonly dense: boolean;
  /** Beside the note (a message sent in Slack: its link there). */
  readonly extra?: ReactNode;
  /** The message's images and the chat they are read from. */
  readonly images?: { readonly chatId: string; readonly list: readonly ChatImage[] } | undefined;
}) {
  const { author, own } = prompter;
  const system = author.kind === 'system';
  const imagesOnly = images !== undefined && images.list.length > 0 && isImagesPrompt(prompt);
  return (
    <MessageAuthor
      author={author}
      at={at}
      side={own ? 'end' : 'start'}
      dense={dense}
      className="group/message"
    >
      {images && <MessageImages chatId={images.chatId} images={images.list} own={own} />}
      {!imagesOnly && (
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
      )}
      <div className="flex min-h-7 items-center gap-2">
        {note && <span className="text-2xs text-dim">{note}</span>}
        {extra}
        <MessageActions text={prompt} label="Copy message" className={REVEAL_ACTIONS} />
      </div>
    </MessageAuthor>
  );
}
