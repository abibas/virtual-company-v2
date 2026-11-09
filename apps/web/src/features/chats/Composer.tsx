import { CHAT_PROMPT } from '@mwc/shared/chats';
import { SendHorizontal, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { cx } from '../../components/cx.ts';
import { CONTROL } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
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
}: {
  /** A turn of this chat runs: Stop instead of Send. */
  readonly running: boolean;
  /** Why nothing can be sent now (archived, not an admin), shown instead of the box. */
  readonly disabled: string | undefined;
  readonly placeholder: string;
  readonly onSend: (prompt: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const ready = text.trim().length > 0 && !running && !busy;
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) void run(() => onSend(text)).then((sent) => sent && setText(''));
  };
  if (disabled) return <p className="border-t border-line px-5 py-4 text-sm text-dim">{disabled}</p>;
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
      <p className="text-2xs text-faint">Enter sends · Shift+Enter for a new line</p>
    </form>
  );
}
