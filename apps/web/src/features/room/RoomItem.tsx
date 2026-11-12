import { stepEndMove } from '@mwc/shared/flows';
import { useState } from 'react';
import type { RoomMessage } from '../../api/room.ts';
import { Link } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { formatDateTime, formatTime } from '../../components/data/format.ts';
import { MessageAuthor, MessageFace } from '../../components/feed/MessageAuthor.tsx';
import type { Prompter } from '../chats/thread/authors.ts';
import { Markdown } from '../chats/thread/markdown/Markdown.tsx';
import { PromptMessage } from '../chats/thread/PromptMessage.tsx';
import { headline } from './model.ts';

/**
 * One message of the team room (docs/processes.md "The team room") under its author: a person's in a bubble (the
 * reader's own on the right), an agent's reply as Markdown, a step agent's line when its step ended on one compact row
 * with the task's chip and its move, and Most Wanted's notice as its headline, opened in place.
 */

const Time = ({ at }: { readonly at: string }) => (
  <time dateTime={at} title={formatDateTime(at)} className="shrink-0 text-2xs text-faint tabular">
    {formatTime(at)}
  </time>
);

/** A step-end line: the face, the agent, the task's chip, the move and the agent's words, on one row. */
function StepEndLine({
  message,
  who,
  taskHref,
  dense,
}: {
  readonly message: RoomMessage;
  readonly who: Prompter;
  readonly taskHref: ((key: string) => string) | undefined;
  readonly dense: boolean;
}) {
  const step = message.step;
  const task = message.task;
  return (
    <div className={cx('flex min-w-0 items-center gap-2 text-xs', dense ? 'py-0.5' : 'py-1')}>
      <MessageFace author={who.author} dense />
      <span className="shrink-0 font-semibold text-ink">{who.author.name}</span>
      {task &&
        (taskHref ? (
          <Link
            to={taskHref(task.key)}
            title={task.title}
            className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-2xs font-bold text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            {task.key}
          </Link>
        ) : (
          <span className="shrink-0 font-mono text-2xs font-bold text-dim">{task.key}</span>
        ))}
      {step && <span className="shrink-0 text-ink-2">{stepEndMove(step)}</span>}
      {step && step.words !== '' && (
        <span title={step.words} className="min-w-0 truncate text-dim">
          {step.words}
        </span>
      )}
      <span className="ml-auto pl-1">
        <Time at={message.at} />
      </span>
    </div>
  );
}

/** Most Wanted's notice: its headline, the rest opened in place. */
function Notice({ message, dense }: { readonly message: RoomMessage; readonly dense: boolean }) {
  const [open, setOpen] = useState(false);
  const { first, more } = headline(message.body);
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <MessageFace author={{ kind: 'system', name: 'Most Wanted' }} dense />
      <div className={cx('grid min-w-0 flex-1 gap-1', dense ? 'pt-0.5' : 'pt-1')}>
        <p className="min-w-0 text-ink-2">
          {first}
          {more && (
            <button
              type="button"
              onClick={() => setOpen((was) => !was)}
              aria-expanded={open}
              className="ml-1.5 cursor-pointer font-semibold text-dim hover:text-ink"
            >
              {open ? 'Less' : 'More'}
            </button>
          )}
        </p>
        {open && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 leading-relaxed break-words whitespace-pre-wrap text-ink-2">
            {message.body.split('\n').slice(1).join('\n').trim()}
          </p>
        )}
      </div>
      <Time at={message.at} />
    </div>
  );
}

export function RoomItem({
  message,
  who,
  taskHref,
  dense,
}: {
  readonly message: RoomMessage;
  readonly who: Prompter;
  /** A task's page by its key; none: the chip is text. */
  readonly taskHref: ((key: string) => string) | undefined;
  readonly dense: boolean;
}) {
  if (message.kind === 'step_end')
    return <StepEndLine message={message} who={who} taskHref={taskHref} dense={dense} />;
  if (message.kind === 'notice') return <Notice message={message} dense={dense} />;
  if (message.kind === 'message')
    return (
      <PromptMessage prompt={message.body} prompter={who} at={message.at} note={undefined} dense={dense} />
    );
  return (
    <MessageAuthor author={who.author} at={message.at} dense={dense}>
      <Markdown text={message.body} {...(dense ? { className: 'text-sm' } : {})} />
    </MessageAuthor>
  );
}
