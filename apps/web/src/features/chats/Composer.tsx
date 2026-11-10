import { CHAT_PROMPT } from '@mwc/shared/chats';
import { ArrowUp, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import type { ChatDelivery } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { Spinner } from '../../components/ui/Button.tsx';
import { iconButtonClass } from '../../components/ui/IconButton.tsx';
import { DeliveryStrip } from './delivery/DeliveryStrip.tsx';
import { type DeliveryChoice, offered, rememberDelivery, rememberedDelivery } from './delivery/delivery.ts';
import { DictationButton } from './dictation/DictationButton.tsx';
import { THREAD_WIDTH } from './thread/ChatThread.tsx';
import { useAction } from './use-action.ts';

/** Enter sends; Shift+Enter, and Enter while an input method composes a character, make a new line. */
function enterSends(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  send();
}

/** The delivery this browser last chose, remembered on each change. */
function useDelivery() {
  const [delivery, setDelivery] = useState<ChatDelivery>(rememberedDelivery);
  const choose = (next: ChatDelivery) => {
    setDelivery(next);
    rememberDelivery(next);
  };
  return [delivery, choose] as const;
}

/** Send (and Stop beside it while a turn runs): round buttons at the card's bottom right, a spinner while busy. */
function RoundAction({
  label,
  busy,
  danger = false,
  submit = false,
  disabled = false,
  onClick,
}: {
  readonly label: string;
  readonly busy: boolean;
  /** Stop: the soft round button with a red square. */
  readonly danger?: boolean;
  /** Send: submits the form. */
  readonly submit?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  const Icon = danger ? Square : ArrowUp;
  return (
    <button
      type={submit ? 'submit' : 'button'}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      onClick={onClick}
      disabled={disabled || busy}
      className={iconButtonClass({
        tone: danger ? 'soft' : 'primary',
        size: 'sm',
        round: true,
        className: cx('size-9', danger && 'text-failed hover:text-failed'),
      })}
    >
      {busy ? (
        <Spinner size={16} />
      ) : (
        <Icon
          size={danger ? 14 : 18}
          strokeWidth={2.5}
          aria-hidden="true"
          className={cx(danger && 'fill-current')}
        />
      )}
    </button>
  );
}

/**
 * The message box under the thread (S5.1c): a rounded card with the text on top and its toolbar inside it (dictation,
 * the context meter, the hint, Stop and the round Send). Enter sends, Shift+Enter makes a new line. While a turn runs
 * (S5.2 step 6) it stays open with a strip above it that says how the message reaches the agent (Now, After this turn,
 * Interrupt; the last choice remembered in this browser), Stop beside Send, and the waiting messages above it. A
 * refusal (the machine offline, the runner too old, an empty slot) shows above it in plain words, and the text stays so
 * it can be sent again.
 */
export function Composer({
  running,
  choices,
  disabled,
  placeholder,
  onSend,
  onStop,
  queue,
  meter,
}: {
  /** A turn of this chat runs: Stop beside Send. */
  readonly running: boolean;
  /** How a message may reach the agent now; undefined when nothing runs or waits (it starts at once). */
  readonly choices: readonly DeliveryChoice[] | undefined;
  /** Why nothing can be sent now (archived, not an admin), shown instead of the box. */
  readonly disabled: string | undefined;
  readonly placeholder: string;
  readonly onSend: (prompt: string, delivery: ChatDelivery | undefined) => Promise<void>;
  readonly onStop: () => Promise<void>;
  /** The waiting messages (S5.2 step 6), above the box. */
  readonly queue?: ReactNode;
  /** The context meter (S5.2), in the card's toolbar, and beside the reason when the box is closed. */
  readonly meter?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [delivery, choose] = useDelivery();
  const { busy, error, run } = useAction();
  const stop = useAction();
  const ready = text.trim().length > 0 && !busy;
  const how = choices && offered(delivery, choices);
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) void run(() => onSend(text, how)).then((sent) => sent && setText(''));
  };
  if (disabled)
    return (
      <div className="px-4 pb-4 md:px-8">
        <div
          className={cx(
            THREAD_WIDTH,
            'flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-4 py-3',
          )}
        >
          <p className="text-sm text-dim">{disabled}</p>
          {meter}
        </div>
      </div>
    );
  const shownError = error ?? stop.error;
  return (
    <form onSubmit={send} className="px-4 pt-1 pb-4 md:px-8">
      <div className={cx(THREAD_WIDTH, 'grid gap-2')}>
        {queue}
        {shownError && (
          <p role="alert" className="text-sm font-medium text-failed">
            {shownError}
          </p>
        )}
        {choices && running && how && <DeliveryStrip choices={choices} value={how} onChange={choose} />}
        <div className="rounded-3xl bg-surface shadow-card ring-1 ring-line-2 transition-shadow ring-inset focus-within:ring-blue/60">
          <textarea
            aria-label="Message"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => enterSends(event, send)}
            maxLength={CHAT_PROMPT.max}
            rows={2}
            placeholder={running ? 'Write while the agent works…' : placeholder}
            className="block max-h-60 min-h-14 w-full resize-none bg-transparent px-4.5 pt-3.5 pb-1 text-[0.9375rem] leading-relaxed text-ink outline-none placeholder:text-faint [field-sizing:content]"
          />
          <div className="flex min-h-12 items-center gap-1 py-1.5 pr-2 pl-2.5">
            <DictationButton value={text} onChange={setText} />
            <div className="min-w-0">{meter}</div>
            <p className="ml-auto hidden pr-1.5 text-2xs text-faint xl:block">
              Enter sends · Shift+Enter for a new line
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:ml-0">
              {running && (
                <RoundAction
                  label="Stop the agent"
                  danger
                  busy={stop.busy}
                  onClick={() => void stop.run(onStop)}
                />
              )}
              <RoundAction label="Send" submit busy={busy} disabled={!ready} />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
