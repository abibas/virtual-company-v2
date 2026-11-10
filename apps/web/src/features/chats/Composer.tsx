import { CHAT_PROMPT } from '@mwc/shared/chats';
import { SendHorizontal, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import type { ChatDelivery } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { CONTROL } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { DeliveryStrip } from './delivery/DeliveryStrip.tsx';
import { type DeliveryChoice, offered, rememberDelivery, rememberedDelivery } from './delivery/delivery.ts';
import { DictationButton } from './dictation/DictationButton.tsx';
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

/**
 * The message box under the thread (S5.1c): Enter sends, Shift+Enter makes a new line. While a turn runs (S5.2 step 6)
 * it stays open with a strip that says how the message reaches the agent (Now, After this turn, Interrupt; the last
 * choice remembered in this browser), Stop beside Send, and the waiting messages above it. A refusal (the machine
 * offline, the runner too old, an empty slot) shows above it in plain words, and the text stays so it can be sent again.
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
  /** The context meter (S5.2), under the box beside the hint, and beside the reason when the box is closed. */
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
        <p className="text-sm text-dim">{disabled}</p>
        {meter}
      </div>
    );
  const shownError = error ?? stop.error;
  return (
    <form onSubmit={send} className="grid gap-2 border-t border-line px-4 py-3 md:px-5">
      {queue}
      {shownError && (
        <p role="alert" className="text-sm font-medium text-failed">
          {shownError}
        </p>
      )}
      {choices && running && how && <DeliveryStrip choices={choices} value={how} onChange={choose} />}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => enterSends(event, send)}
          maxLength={CHAT_PROMPT.max}
          rows={2}
          placeholder={running ? 'Write while the agent works…' : placeholder}
          className={cx(CONTROL, 'h-auto max-h-48 min-h-11 flex-1 resize-none py-2.5 text-sm')}
        />
        {running && (
          <Button tone="danger" icon={Square} busy={stop.busy} onClick={() => void stop.run(onStop)}>
            Stop
          </Button>
        )}
        <Button type="submit" tone="primary" icon={SendHorizontal} busy={busy} disabled={!ready}>
          Send
        </Button>
      </div>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <DictationButton value={text} onChange={setText} />
          {meter}
        </div>
        <p className="text-2xs text-faint">Enter sends · Shift+Enter for a new line</p>
      </div>
    </form>
  );
}
