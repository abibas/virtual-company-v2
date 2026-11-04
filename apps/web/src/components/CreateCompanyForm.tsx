import { type FormEvent, type ReactNode, useState } from 'react';
import { useApi } from '../api/context.ts';
import { call, friendlyMessage } from '../api/errors.ts';
import type { Company } from '../api/types.ts';
import { Button } from './ui/Button.tsx';
import { TextField } from './ui/Field.tsx';
import { Notice } from './ui/Notice.tsx';

/** A slug as the server accepts it (`companies/rules.ts`), for the browser's own check. */
export const SLUG_INPUT_PATTERN = '[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?';

interface CreateCompanyFormProps {
  readonly onCreated: (company: Company) => Promise<void>;
  /** A way back, beside the button (none on the first company). */
  readonly cancel?: ReactNode;
}

/** The name and address typed so far, and `POST /api/companies` with its progress and refusal. */
function useCreateCompany(onCreated: CreateCompanyFormProps['onCreated']) {
  const api = useApi();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const chosen = slug.trim();
      await onCreated(
        await call(
          api.api.companies.$post({ json: { name: name.trim(), ...(chosen ? { slug: chosen } : {}) } }),
        ),
      );
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };
  return { name, setName, slug, setSlug, busy, error, create };
}

/** `POST /api/companies {name, slug?}`: the name, an optional address (made from the name when empty). */
export function CreateCompanyForm({ onCreated, cancel }: CreateCompanyFormProps) {
  const form = useCreateCompany(onCreated);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.create();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label="Company name"
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
        required
        maxLength={100}
        autoComplete="organization"
        placeholder="Most Wanted"
      />
      <TextField
        label="Address (optional)"
        value={form.slug}
        onChange={(event) => form.setSlug(event.target.value.toLowerCase())}
        pattern={SLUG_INPUT_PATTERN}
        maxLength={63}
        spellCheck={false}
        placeholder="most-wanted"
        hint={
          <>
            The company opens at <span className="font-mono">/c/{form.slug.trim() || 'your-address'}</span>:
            lower-case letters, digits and dashes. Left empty, it is made from the name.
          </>
        }
      />
      {form.error !== undefined && <Notice tone="error">{friendlyMessage(form.error)}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" tone="primary" busy={form.busy} disabled={form.name.trim() === ''}>
          Create company
        </Button>
        {cancel}
      </div>
    </form>
  );
}
