import { Pencil } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { cx } from '../cx.ts';
import { Button } from '../ui/Button.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { Input } from './Input.tsx';

interface InlineEditProps {
  readonly value: string;
  /** What is edited, for screen readers and the button ("Rename"). */
  readonly label: string;
  /** Saves the new value; a refusal stays under the field in plain words. */
  readonly onSave: (next: string) => Promise<unknown>;
  readonly maxLength?: number | undefined;
  readonly disabled?: boolean;
  readonly className?: string;
  /** How the value reads when it is not edited (a heading); the plain value by default. */
  readonly children?: ReactNode;
}

/** The open edit: the field (focused, its text selected), Save and Cancel; Enter saves, Escape cancels. */
function EditForm({
  value,
  label,
  onSave,
  maxLength,
  onClose,
}: Pick<InlineEditProps, 'value' | 'label' | 'onSave' | 'maxLength'> & { readonly onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const next = draft.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next === value) return onClose();
    setBusy(true);
    setError(undefined);
    try {
      await onSave(next);
      onClose();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-wrap items-center gap-2">
      <Input
        size="sm"
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || busy) return;
          event.stopPropagation();
          onClose();
        }}
        aria-invalid={error ? true : undefined}
        className="w-64 max-w-full"
      />
      <Button type="submit" size="sm" tone="primary" busy={busy} disabled={next === ''}>
        Save
      </Button>
      <Button size="sm" tone="quiet" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * A name changed in place: the name with a Rename button beside it, which turns into a field with Save and Cancel.
 * Focus comes back to the button when the field closes.
 */
export function InlineEdit({
  value,
  label,
  onSave,
  maxLength,
  disabled,
  className,
  children,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) button.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  if (editing) {
    return (
      <EditForm
        value={value}
        label={label}
        onSave={onSave}
        maxLength={maxLength}
        onClose={() => setEditing(false)}
      />
    );
  }
  return (
    <span className={cx('inline-flex max-w-full min-w-0 items-center gap-1', className)}>
      <span className="min-w-0 truncate">{children ?? value}</span>
      {!disabled && (
        <IconButton
          ref={button}
          label={label}
          icon={Pencil}
          size="sm"
          onClick={() => setEditing(true)}
          className="size-7 shrink-0"
        />
      )}
    </span>
  );
}
