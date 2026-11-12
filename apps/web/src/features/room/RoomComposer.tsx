import { ROOM_MESSAGE_MAX } from '@mwc/shared/flows';
import { ArrowUp } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import type { RoomMember } from '../../api/room.ts';
import type { ChartNode } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { MessageFace } from '../../components/feed/MessageAuthor.tsx';
import { Spinner } from '../../components/ui/Button.tsx';
import { iconButtonClass } from '../../components/ui/IconButton.tsx';
import { useAction } from '../chats/use-action.ts';
import { completeMention, type MentionDraft, memberAuthor, mentionAt, mentionChoices } from './model.ts';

/**
 * The team room's message box (docs/processes.md "The team room"): Enter sends, Shift+Enter makes a new line; typing "@"
 * offers the room's agents (arrows to choose, Enter or Tab to take one, Escape to close), and a message that names some
 * goes to those only. A refusal shows above it and the text stays. Those who may not write get one line instead.
 */

/** The agents an "@" offers, under the box's top edge. */
function MentionList({
  choices,
  active,
  nodes,
  onPick,
}: {
  readonly choices: readonly RoomMember[];
  readonly active: number;
  readonly nodes: ReadonlyMap<string, ChartNode> | undefined;
  readonly onPick: (agent: RoomMember) => void;
}) {
  return (
    <ul
      role="listbox"
      aria-label="Agents"
      className="absolute bottom-full left-2 z-10 mb-1 grid min-w-48 gap-0.5 rounded-xl bg-surface p-1 shadow-float ring-1 ring-line-2"
    >
      {choices.map((agent, index) => (
        <li key={agent.principalId} role="option" aria-selected={index === active}>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(agent);
            }}
            className={cx(
              'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
              index === active ? 'bg-blue-soft text-ink' : 'text-ink-2 hover:bg-surface-2',
            )}
          >
            <MessageFace author={memberAuthor(agent, nodes)} dense />
            {agent.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoomComposer({
  agents,
  nodes,
  mayWrite,
  dense,
  onSend,
}: {
  readonly agents: readonly RoomMember[];
  readonly nodes: ReadonlyMap<string, ChartNode> | undefined;
  readonly mayWrite: boolean;
  readonly dense: boolean;
  readonly onSend: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<MentionDraft>();
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();
  const pad = dense ? 'px-2 pt-1 pb-1' : 'px-4 pt-1 pb-4 md:px-8';
  if (!mayWrite)
    return (
      <div className={pad}>
        <p className="mx-auto w-full max-w-[44rem] rounded-2xl bg-surface-2 px-4 py-3 text-sm text-dim">
          Only the team’s people and admins write here.
        </p>
      </div>
    );
  const choices = draft === undefined ? [] : mentionChoices(agents, draft.query);
  const ready = text.trim().length > 0 && !busy;
  const track = (value: string, caret: number) => {
    setText(value);
    setDraft(mentionAt(value, caret));
    setActive(0);
  };
  const pick = (agent: RoomMember) => {
    const element = box.current;
    if (draft === undefined || element === null) return;
    const done = completeMention(text, element.selectionStart, draft, agent);
    setText(done.text);
    setDraft(undefined);
    requestAnimationFrame(() => element.setSelectionRange(done.caret, done.caret));
  };
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) void run(() => onSend(text.trim())).then((sent) => sent && setText(''));
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (choices.length > 0) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step !== undefined) {
        event.preventDefault();
        setActive((active + step + choices.length) % choices.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(choices[active] as RoomMember);
        return;
      }
      if (event.key === 'Escape') return setDraft(undefined);
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <form onSubmit={send} className={pad}>
      <div className="mx-auto grid w-full max-w-[44rem] gap-2">
        {error && (
          <p role="alert" className="text-sm font-medium text-failed">
            {error}
          </p>
        )}
        <div className="relative rounded-3xl bg-surface shadow-card ring-1 ring-line-2 transition-shadow ring-inset focus-within:ring-blue/60">
          {choices.length > 0 && (
            <MentionList choices={choices} active={active} nodes={nodes} onPick={pick} />
          )}
          <div className="flex items-end gap-2 py-1.5 pr-2 pl-4">
            <textarea
              ref={box}
              aria-label="Message the team"
              value={text}
              onChange={(event) => track(event.target.value, event.target.selectionStart)}
              onKeyDown={keys}
              onBlur={() => setDraft(undefined)}
              maxLength={ROOM_MESSAGE_MAX}
              rows={1}
              placeholder="Message the team"
              className="block max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem] leading-relaxed text-ink outline-none placeholder:text-faint [field-sizing:content]"
            />
            <button
              type="submit"
              aria-label="Send"
              title="Send"
              disabled={!ready}
              className={iconButtonClass({
                tone: 'primary',
                size: 'sm',
                round: true,
                className: 'size-9 shrink-0',
              })}
            >
              {busy ? <Spinner size={16} /> : <ArrowUp size={18} strokeWidth={2.5} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
