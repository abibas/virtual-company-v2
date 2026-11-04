import { type RefObject, useEffect, useRef, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { Button, type ButtonTone } from './Button.tsx';

interface ConfirmInlineProps {
  /** The action as the first button says it ("Remove", "Revoke", "Leave company"). */
  readonly label: string;
  /** What will happen, shown once the first button is pressed. */
  readonly question: string;
  /** The confirming button ("Remove", "Leave"). */
  readonly confirmLabel: string;
  readonly onConfirm: () => Promise<void>;
  readonly tone?: ButtonTone;
  readonly disabled?: boolean;
}

/** The open confirmation: the question, Cancel (focused first) and the confirming button; Escape cancels. */
function ConfirmPrompt({
  question,
  confirmLabel,
  busy,
  error,
  cancelRef,
  onCancel,
  onConfirm,
}: {
  readonly question: string;
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly cancelRef: RefObject<HTMLButtonElement | null>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the confirmation cancels it.
    <div
      className="flex flex-col items-end gap-2 text-right"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <p className="max-w-xs text-[12.5px] text-ink-2">{question}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="danger" busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="max-w-xs text-[12.5px] text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A destructive action confirmed in place (never a browser dialog): the button turns into the question with the
 * confirming button and Cancel. Escape or Cancel goes back, with focus on the button again; a refusal stays on screen
 * in plain words.
 */
export function ConfirmInline({
  label,
  question,
  confirmLabel,
  onConfirm,
  tone = 'quiet',
  disabled = false,
}: ConfirmInlineProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = () => {
    setOpen(false);
    setError(undefined);
  };
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
      setOpen(false);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button ref={triggerRef} size="sm" tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <ConfirmPrompt
      question={question}
      confirmLabel={confirmLabel}
      busy={busy}
      error={error}
      cancelRef={cancelRef}
      onCancel={close}
      onConfirm={() => void confirm()}
    />
  );
}
