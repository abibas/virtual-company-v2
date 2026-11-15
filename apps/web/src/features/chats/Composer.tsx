import { CHAT_PROMPT } from '@mwc/shared/chats';
import { ArrowUp, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import type { ChatDelivery } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { Spinner } from '../../components/ui/Button.tsx';
import { iconButtonClass } from '../../components/ui/IconButton.tsx';
import { AttachmentChips } from './attach/AttachmentChips.tsx';
import { ATTACH_REFUSALS, imagesPrompt, imagesRefusal } from './attach/image-files.ts';
import { useMarkedText } from './attach/use-marked-text.ts';
import { DeliveryStrip } from './delivery/DeliveryStrip.tsx';
import { type DeliveryChoice, offered, rememberDelivery, rememberedDelivery } from './delivery/delivery.ts';
import { StartAndSend, startable } from './delivery/StartAndSend.tsx';
import { DictationButton } from './dictation/DictationButton.tsx';
import { useComposerDictation } from './dictation/use-composer-dictation.ts';
import { SlackTarget, type SlackTargetValue } from './people/SlackTarget.tsx';
import { THREAD_WIDTH } from './thread/ChatThread.tsx';
import { useAction } from './use-action.ts';

/** What a send carries besides the prompt and its delivery: the stopped machine started for it, its images (T-18). */
export interface ComposerSendOptions {
  readonly startMachine?: boolean;
  readonly images?: readonly Blob[];
}

/** The text box's hint: where the message goes, or that a drag of images can be dropped. */
function hintOf(placeholder: string, place: string | undefined, running: boolean, dragging: boolean): string {
  if (dragging) return 'Drop the images to attach them';
  if (place !== undefined) return `Send in ${place}, as the bot`;
  return running ? 'Write while the agent works…' : placeholder;
}

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
        className: cx('size-8 @sm/composer:size-9', danger && 'text-failed hover:text-failed'),
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
 * The message box under the thread (S5.1c): a rounded card with the text on top and its footer inside it, one row that
 * never wraps: dictation and the chat's Mode and Model pills on the left, the context ring, Stop and the round Send on
 * the right. The card is the `composer` container: the pills and the ring drop their words by its width (the full chat,
 * the rail's docked chat, a phone), so the row fits as it is. Enter sends, Shift+Enter makes a new line. While a turn runs
 * (S5.2 step 6) it stays open with a strip above it that says how the message reaches the agent (Now, After this turn,
 * Interrupt; the last choice remembered in this browser), Stop beside Send, and the waiting messages above it. A
 * refusal (the machine offline, the runner too old, an empty slot) shows above it in plain words, and the text stays so
 * it can be sent again; a stopped machine the person may start offers Start and send. In a Slack conversation's chat
 * its Slack connection's owner chooses above the box where the message goes (2026-11-14): Ask the agent or Send in
 * Slack. Closed, it shows why in one line, with what may open it (an owner's Add me). Images dropped on the card or
 * pasted in the text (T-18) show as chips above the text and go to the agent with the message (`attach/`); each puts
 * its `[Image N]` marker in the text at the cursor, linked to its chip (T-20, `use-marked-text.ts`).
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
  runs,
  dense = false,
  aside,
  slack,
}: {
  /** A turn of this chat runs: Stop beside Send. */
  readonly running: boolean;
  /** How a message may reach the agent now; undefined when nothing runs or waits (it starts at once). */
  readonly choices: readonly DeliveryChoice[] | undefined;
  /** Why nothing can be sent now (archived, not an admin), shown instead of the box. */
  readonly disabled: string | undefined;
  readonly placeholder: string;
  readonly onSend: (
    prompt: string,
    delivery: ChatDelivery | undefined,
    options?: ComposerSendOptions,
  ) => Promise<void>;
  readonly onStop: () => Promise<void>;
  /** The waiting messages (S5.2 step 6), above the box. */
  readonly queue?: ReactNode;
  /** The context meter (S5.2), in the card's footer, and beside the reason when the box is closed. */
  readonly meter?: ReactNode;
  /** The chat's Mode and Model menus (2026-11-13), in the card's footer after the microphone. */
  readonly runs?: ReactNode;
  /** Narrow (the right rail's docked chat): tighter margins. */
  readonly dense?: boolean;
  /** Beside the reason when the box is closed (an owner's Add me, 2026-11-14). */
  readonly aside?: ReactNode;
  /** A Slack conversation's chat whose connection the reader owns (2026-11-14): Ask the agent or Send in Slack. */
  readonly slack?: { readonly place: string; readonly onSend: (text: string) => Promise<void> } | undefined;
}) {
  const [to, setTo] = useState<SlackTargetValue>('agent');
  const inSlack = slack !== undefined && to === 'slack';
  const [delivery, choose] = useDelivery();
  const { busy, error, failure, run } = useAction();
  const stop = useAction();
  const marked = useMarkedText(inSlack ? ATTACH_REFUSALS.slack : undefined);
  const { text, attach } = marked;
  const dictation = useComposerDictation({ box: marked.box, now: marked.now, onChange: marked.change });
  const attached = inSlack ? [] : attach.items;
  // While it records (or transcribes) Send means "stop and send", even with an empty box (T-32).
  const dictating = dictation.state !== 'idle';
  const ready = (text.trim().length > 0 || attached.length > 0 || dictating) && attach.preparing === 0 && !busy;
  const how = choices && offered(delivery, choices);
  const send = (event?: FormEvent, options?: { readonly startMachine?: boolean }) => {
    event?.preventDefault();
    if (!ready) return;
    attach.dismiss();
    let sent = false;
    void run(async () => {
      // A recording stops and its words go in at the cursor first (Send's spinner meanwhile); when hearing fails its
      // message shows and nothing is sent, the text and images kept.
      if (!(await dictation.settle())) return;
      const now = marked.now();
      const hasText = now.trim().length > 0;
      if (!hasText && attached.length === 0) return;
      const out = marked.outgoing(attached);
      const prompt = hasText ? out.prompt : imagesPrompt(attached.length);
      await (inSlack ? slack.onSend(now) : onSend(prompt, how, { ...options, images: out.images }));
      sent = true;
    }).then(() => {
      if (sent) marked.sent(attached);
    });
  };
  const stopped = startable(failure);
  if (disabled)
    return (
      <div className={dense ? 'px-1 pb-0.5' : 'px-4 pb-4 md:px-8'}>
        <div
          className={cx(
            THREAD_WIDTH,
            '@container/composer flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-4 py-3',
          )}
        >
          <p className="text-sm text-dim">{disabled}</p>
          {aside ?? meter}
        </div>
      </div>
    );
  // While Start and send stands for the refusal, only a refused image still shows.
  const refusal = imagesRefusal(failure, attached.length) ?? error ?? stop.error;
  const shownError = attach.error ?? (stopped ? undefined : refusal);
  return (
    <form onSubmit={send} className={dense ? 'px-1 pt-1 pb-0.5' : 'px-4 pt-1 pb-4 md:px-8'}>
      <div className={cx(THREAD_WIDTH, 'grid gap-2')}>
        {queue}
        {stopped && (
          <StartAndSend
            machine={stopped}
            busy={busy}
            disabled={!ready}
            onStart={() => send(undefined, { startMachine: true })}
          />
        )}
        {shownError && (
          <p role="alert" className="text-sm font-medium text-failed">
            {shownError}
          </p>
        )}
        {slack && <SlackTarget value={to} place={slack.place} onChange={setTo} />}
        {choices && running && how && !inSlack && (
          <DeliveryStrip choices={choices} value={how} onChange={choose} />
        )}
        <div
          {...attach.dropZone}
          data-dragging={attach.dragging || undefined}
          className="@container/composer rounded-3xl bg-surface shadow-card ring-1 ring-line-2 transition-[box-shadow,background-color] ring-inset focus-within:ring-blue/60 data-dragging:bg-blue-soft/50 data-dragging:ring-2 data-dragging:ring-blue"
        >
          <AttachmentChips items={attach.items} muted={inSlack} onRemove={attach.remove} />
          <textarea
            ref={marked.box}
            aria-label="Message"
            aria-busy={dictation.state === 'transcribing' || undefined}
            value={text}
            onChange={(event) => marked.change(event.target.value)}
            onKeyDown={(event) => enterSends(event, send)}
            onPaste={attach.onPaste}
            maxLength={CHAT_PROMPT.max}
            rows={2}
            placeholder={hintOf(placeholder, inSlack ? slack.place : undefined, running, attach.dragging)}
            className="block max-h-60 min-h-14 w-full resize-none bg-transparent px-4.5 pt-3.5 pb-1 text-[0.9375rem] leading-relaxed text-ink outline-none placeholder:text-faint [field-sizing:content]"
          />
          <div className="flex min-h-12 flex-nowrap items-center gap-1 px-1.5 py-1.5 @sm/composer:px-2">
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              <DictationButton dictation={dictation} />
              {runs}
            </div>
            <div className="flex max-w-[60%] min-w-0 items-center justify-end gap-1 @sm/composer:gap-1.5">
              <div className="flex min-w-0 items-center">{meter}</div>
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
