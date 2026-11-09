import { CHAT_PROMPT } from '@mwc/shared/chats';
import { Clock3, Pencil, SendHorizontal, SkipForward, Trash2, Zap } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { CONTROL } from '../../../components/forms/Input.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { type Action, useAction } from '../use-action.ts';
import { WAITING_NOTE } from './delivery.ts';

/** What the person can do with a waiting message. */
export interface QueueActions {
  /** A turn runs that takes a message Now (Claude Code's message turn). */
  readonly canNow: boolean;
  /** A turn runs that Interrupt would stop. */
  readonly running: boolean;
  edit(turnId: string, prompt: string): Promise<void>;
  discard(turnId: string): Promise<void>;
  deliver(turnId: string, delivery: 'now' | 'interrupt'): Promise<void>;
}

/** The box that changes a waiting message: Enter saves, Shift+Enter makes a new line, Escape cancels. */
function EditBox({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  readonly initial: string;
  readonly busy: boolean;
  readonly onSave: (prompt: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const ready = text.trim().length > 0 && !busy;
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') onCancel();
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (ready) onSave(text);
  };
  return (
    <div className="grid gap-1.5">
      <textarea
        ref={box}
        aria-label="Waiting message"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keys}
        maxLength={CHAT_PROMPT.max}
        rows={2}
        className={cx(CONTROL, 'h-auto max-h-40 min-h-10 resize-none py-2 text-sm')}
      />
      <div className="flex gap-1.5">
        <Button size="sm" tone="primary" busy={busy} disabled={!ready} onClick={() => onSave(text)}>
          Save
        </Button>
        <Button size="sm" tone="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Edit, Send now (into a turn that takes it), Interrupt (a running turn) and Discard for a waiting message. */
function RowActions({
  turn,
  actions,
  busy,
  run,
  onEdit,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly actions: QueueActions;
  readonly busy: boolean;
  readonly run: Action['run'];
  readonly onEdit: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton size="sm" icon={Pencil} label="Edit" tooltip="top" onClick={onEdit} />
      {actions.canNow && (
        <IconButton
          size="sm"
          icon={Zap}
          label="Send now, into the running turn"
          tooltip="top"
          disabled={busy}
          onClick={() => void run(() => actions.deliver(turn.id, 'now'))}
        />
      )}
      {actions.running && turn.delivery !== 'interrupt' && (
        <IconButton
          size="sm"
          icon={SkipForward}
          label="Interrupt the turn and send this"
          tooltip="top"
          disabled={busy}
          onClick={() => void run(() => actions.deliver(turn.id, 'interrupt'))}
        />
      )}
      <IconButton
        size="sm"
        icon={Trash2}
        label="Discard"
        tooltip="top"
        disabled={busy}
        onClick={() => void run(() => actions.discard(turn.id))}
      />
    </div>
  );
}

/** One waiting message: its text and what happens to it, with its actions while it can still change. */
function QueuedRow({ turn, actions }: { readonly turn: ChatTurnWithEvents; readonly actions: QueueActions }) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  const delivery = turn.delivery ?? 'after';
  const sent = delivery === 'now';
  const save = (prompt: string) =>
    void run(() => actions.edit(turn.id, prompt)).then((ok) => ok && setEditing(false));
  return (
    <li className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-line ring-inset">
      {sent ? (
        <SendHorizontal size={14} aria-hidden="true" className="mt-1 shrink-0 text-blue" />
      ) : (
        <Clock3 size={14} aria-hidden="true" className="mt-1 shrink-0 text-faint" />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        {editing ? (
          <EditBox initial={turn.prompt} busy={busy} onSave={save} onCancel={() => setEditing(false)} />
        ) : (
          <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-ink">{turn.prompt}</p>
        )}
        <p className={cx('text-2xs', sent ? 'text-blue' : 'text-dim')}>{WAITING_NOTE[delivery]}</p>
        {error && (
          <p role="alert" className="text-2xs font-medium text-failed">
            {error}
          </p>
        )}
      </div>
      {!sent && !editing && (
        <RowActions turn={turn} actions={actions} busy={busy} run={run} onEdit={() => setEditing(true)} />
      )}
    </li>
  );
}

/**
 * The messages waiting for the running turn (S5.2 step 6), above the message box in the order they start: each says
 * what happens to it, and while it waits it can be edited, sent Now, made to interrupt, or discarded. One sent Now
 * waits only until the agent takes it.
 */
export function QueuedMessages({
  queue,
  actions,
}: {
  readonly queue: readonly ChatTurnWithEvents[];
  readonly actions: QueueActions;
}) {
  if (queue.length === 0) return null;
  return (
    <ol aria-label="Waiting messages" className="grid max-h-56 gap-1.5 overflow-y-auto scroll-quiet">
      {queue.map((turn) => (
        <QueuedRow key={turn.id} turn={turn} actions={actions} />
      ))}
    </ol>
  );
}
