import { PERSONAL_KEY_DAYS } from '@mwc/shared/api-keys';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { CreatedApiKey } from '../../api/types.ts';
import { TextField } from '../forms/Field.tsx';
import { Button } from '../ui/Button.tsx';

interface CreateKeyFormProps {
  readonly companyId: string;
  readonly onCreated: (key: CreatedApiKey) => void;
}

/** The key's name and lifetime, and `POST .../api-keys` with its progress and refusal. */
function useCreateKey({ companyId, onCreated }: CreateKeyFormProps) {
  const api = useApi();
  const [name, setName] = useState('');
  const [days, setDays] = useState(String(PERSONAL_KEY_DAYS.default));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const key = await call(
        api.api.companies[':companyId']['api-keys'].$post({
          param: { companyId },
          json: { name: name.trim(), expiresInDays: Number(days) },
        }),
      );
      setName('');
      onCreated(key);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { name, setName, days, setDays, busy, error, create };
}

/** Make a personal key: a name to recognise it by and how many days it lives (90 unless chosen, 1 to 365). */
export function CreateKeyForm(props: CreateKeyFormProps) {
  const form = useCreateKey(props);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.create();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
      <TextField
        label="Name"
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
        required
        maxLength={100}
        autoComplete="off"
        placeholder="laptop"
        error={form.error}
      />
      <TextField
        label="Expires after (days)"
        type="number"
        inputMode="numeric"
        min={PERSONAL_KEY_DAYS.min}
        max={PERSONAL_KEY_DAYS.max}
        step={1}
        value={form.days}
        onChange={(event) => form.setDays(event.target.value)}
        required
      />
      <Button type="submit" tone="primary" busy={form.busy} disabled={form.name.trim() === ''}>
        Create key
      </Button>
    </form>
  );
}
