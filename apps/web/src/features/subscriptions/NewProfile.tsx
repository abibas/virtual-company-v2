import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { NewAccessProfile } from '../../api/types.ts';
import { TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';

/**
 * New profile, on its own card above the list (generic profiles since 2026-11-13): its name only; its parts are added
 * on its card. A refusal (a name taken) shows on the field.
 */
export function NewProfileForm({
  create,
  onCancel,
}: {
  /** Creates it (`POST`) and closes this card. */
  readonly create: (profile: NewAccessProfile) => Promise<unknown>;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await create({ name: name.trim() });
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Card as="section" aria-label="New profile" className="mb-5">
      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            maxLength={ACCESS_PROFILE_NAME.max}
            placeholder="Work"
            error={error}
          />
        </div>
        <div className="flex gap-2">
          <Button tone="quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" busy={busy} disabled={name.trim() === ''}>
            Create profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
