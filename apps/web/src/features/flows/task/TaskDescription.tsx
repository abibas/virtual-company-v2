import { TASK_DESCRIPTION_MAX } from '@mwc/shared/flows';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import { Textarea } from '../../../components/forms/Input.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Markdown } from '../../chats/thread/markdown/Markdown.tsx';

/** The editor in place of the text: Markdown in a monospace field, Save and Cancel; a refusal stays under it. */
function DescriptionEditor({
  value,
  onSave,
  onClose,
}: {
  readonly value: string;
  readonly onSave: (next: string) => Promise<unknown>;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSave(text);
      onClose();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Description (Markdown)"
        autoFocus
        rows={12}
        maxLength={TASK_DESCRIPTION_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="font-mono text-sm"
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" tone="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" busy={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** A task's description as Markdown; those who may edit the task get Edit, which opens the editor in its place. */
export function TaskDescription({
  value,
  editable,
  onSave,
}: {
  readonly value: string;
  readonly editable: boolean;
  readonly onSave: (next: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DescriptionEditor value={value} onSave={onSave} onClose={() => setEditing(false)} />;
  return (
    <div className="relative">
      {editable && (
        <div className="absolute -top-1 right-0">
          <Button size="sm" tone="quiet" icon={Pencil} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
      {value.trim() ? (
        <Markdown text={value} className="pr-20 text-sm" />
      ) : (
        <p className="text-sm text-faint">No description.</p>
      )}
    </div>
  );
}
