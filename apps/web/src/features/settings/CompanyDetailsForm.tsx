import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Company } from '../../api/types.ts';
import { TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { reservedAddressError, SLUG_INPUT_PATTERN } from '../company/slug.ts';

interface CompanyDetailsFormProps {
  readonly companyId: string;
  readonly name: string;
  readonly slug: string;
  readonly onSaved: (company: Company) => Promise<void>;
}

/** The form's fields, what changed since the last save, and the save itself (`PATCH` with the changed fields). */
function useDetailsForm({ companyId, name: savedName, slug: savedSlug, onSaved }: CompanyDetailsFormProps) {
  const api = useApi();
  const [name, setName] = useState(savedName);
  const [slug, setSlug] = useState(savedSlug);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly text: string }>();
  const changes = {
    ...(name.trim() !== savedName ? { name: name.trim() } : {}),
    ...(slug.trim() !== savedSlug ? { slug: slug.trim() } : {}),
  };
  const save = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const company = await call(
        api.api.companies[':companyId'].$patch({ param: { companyId }, json: changes }),
      );
      await onSaved(company);
      setResult({ ok: true, text: 'Saved.' });
    } catch (failure) {
      setResult({ ok: false, text: friendlyMessage(failure) });
    } finally {
      setBusy(false);
    }
  };
  // A company keeps an older reserved address it already has; only a new one is refused.
  const reserved = changes.slug === undefined ? undefined : reservedAddressError(changes.slug);
  const canSave = Object.keys(changes).length > 0 && name.trim() !== '' && reserved === undefined;
  return { name, setName, slug, setSlug, busy, result, reserved, canSave, save };
}

/** Rename the company or change its address (admins and owners); only the fields that changed are sent. */
export function CompanyDetailsForm(props: CompanyDetailsFormProps) {
  const form = useDetailsForm(props);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.save();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Company name"
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
          required
          maxLength={100}
          autoComplete="organization"
        />
        <TextField
          label="Address"
          value={form.slug}
          onChange={(event) => form.setSlug(event.target.value.toLowerCase())}
          required
          pattern={SLUG_INPUT_PATTERN}
          maxLength={63}
          spellCheck={false}
          error={form.reserved}
          hint={
            <>
              Opens at <span className="font-mono">/{form.slug.trim() || '…'}</span>. Old links stop working
              when it changes.
            </>
          }
        />
      </div>
      {form.result && <Notice tone={form.result.ok ? 'success' : 'error'}>{form.result.text}</Notice>}
      <div>
        <Button type="submit" tone="primary" busy={form.busy} disabled={!form.canSave}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
