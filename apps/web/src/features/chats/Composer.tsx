import { CHAT_PROMPT } from '@mwc/shared/chats';
import { SendHorizontal, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import { cx } from '../../components/cx.ts';
import { CONTROL } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { DictationButton } from './dictation/DictationButton.tsx';
import { useAction } from './use-action.ts';

/** Enter sends; Shift+Enter, and Enter while an input method composes a character, make a new line. */
function enterSends(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  send();
}

/**
 * The message box under the thread (S5.1c): Enter sends, Shift+Enter makes a new line; while a turn runs the box waits
 * and Stop takes Send's place. A refusal (the machine offline, the runner too old, an empty slot) shows above it in
 * plain words, and the text stays so it can be sent again.
 */
export function Composer({
  running,
  disabled,
  placeholder,
  onSend,
  onStop,
  meter,
}: {
  /** A turn of this chat runs: Stop instead of Send. */
  readonly running: boolean;
  /** Why nothing can be sent now (archived, not an admin), shown instead of the box. */
  readonly disabled: string | undefined;
  readonly placeholder: string;
  readonly onSend: (prompt: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
  /** The context meter (S5.2), under the box beside the hint, and beside the reason when the box is closed. */
  readonly meter?: ReactNode;
}) {
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const ready = text.trim().length > 0 && !running && !busy;
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) void run(() => onSend(text)).then((sent) => sent && setText(''));
  };
  if (disabled)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
        <p className="text-sm text-dim">{disabled}</p>
        {meter}
      </div>
    );
  return (
    <form onSubmit={send} className="grid gap-2 border-t border-line px-4 py-3 md:px-5">
      {error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => enterSends(event, send)}
          disabled={running}
          maxLength={CHAT_PROMPT.max}
          rows={2}
          placeholder={running ? 'The agent is working…' : placeholder}
          className={cx(CONTROL, 'h-auto max-h-48 min-h-11 flex-1 resize-none py-2.5 text-sm')}
        />
        <DictationButton value={text} onChange={setText} />
        {running ? (
          <Button tone="danger" icon={Square} busy={busy} onClick={() => void run(onStop)}>
            Stop
          </Button>
        ) : (
          <Button type="submit" tone="primary" icon={SendHorizontal} busy={busy} disabled={!ready}>
            Send
          </Button>
        )}
      </div>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-2xs text-faint">Enter sends · Shift+Enter for a new line</p>
        {meter}
      </div>
    </form>
  );
}
