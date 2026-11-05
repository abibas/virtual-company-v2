import { ArrowRight } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { uploadCompanyLogo } from '../../api/company-logo.ts';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import { rememberPendingLogo } from '../../api/pending-logo.ts';
import type { Company } from '../../api/types.ts';
import { cx } from '../cx.ts';
import { TextField } from '../forms/Field.tsx';
import { LogoPicker } from '../forms/image/LogoPicker.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import type { CompanyDraft } from './draft.ts';
import { SLUG_INPUT_PATTERN } from './slug.ts';

interface CreateCompanyFormProps {
  readonly draft: CompanyDraft;
  readonly onCreated: (company: Company) => Promise<void>;
  /** A way back, under the button (none on the first company). */
  readonly cancel?: ReactNode;
  readonly className?: string;
}

type Stage = 'idle' | 'creating' | 'logo';

/**
 * `POST /api/companies` with the draft's name and address, then the logo's upload when one was picked. The company
 * exists once created: a logo refused or lost on the way is kept for the company's page to offer again, never a
 * reason to stop here.
 */
function useCreateCompany(draft: CompanyDraft, onCreated: CreateCompanyFormProps['onCreated']) {
  const api = useApi();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<unknown>();
  const create = async () => {
    setStage('creating');
    setError(undefined);
    try {
      const chosen = draft.slug.trim();
      const company = await call(
        api.api.companies.$post({ json: { name: draft.name.trim(), ...(chosen ? { slug: chosen } : {}) } }),
      );
      const logo = draft.logo;
      if (logo) {
        setStage('logo');
        await uploadCompanyLogo(api, company.id, logo.blob).catch((failure: unknown) =>
          rememberPendingLogo(company.id, logo.blob, failure),
        );
      }
      await onCreated(company);
    } catch (failure) {
      setError(failure);
      setStage('idle');
    }
  };
  return { stage, error, create };
}

/** The live address under the field: `/c/<address>` as the server will make it, and where it comes from. */
function AddressHint({ address, chosen }: { readonly address: string; readonly chosen: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={address ? 'blue' : 'neutral'} className="max-w-full font-mono font-medium">
        <span className="truncate">/c/{address || 'your-address'}</span>
      </Badge>
      <span>
        {chosen
          ? 'Lower-case letters, digits and dashes.'
          : address
            ? 'Made from the name; type one to choose it.'
            : 'Made from the name, or type one.'}
      </span>
    </span>
  );
}

/** The logo, the name and the address of a new company, and the button that creates it. */
export function CreateCompanyForm({ draft, onCreated, cancel, className }: CreateCompanyFormProps) {
  const { stage, error, create } = useCreateCompany(draft, onCreated);
  const busy = stage !== 'idle';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void create();
  };
  return (
    <form onSubmit={submit} className={cx('flex flex-col gap-5', className)}>
      <LogoPicker
        name={draft.name}
        value={draft.logo}
        onChange={draft.setLogo}
        start={draft.startLogo}
        pasteAnywhere
        disabled={busy}
      />
      <TextField
        label="Company name"
        value={draft.name}
        onChange={(event) => draft.setName(event.target.value)}
        required
        maxLength={100}
        autoComplete="organization"
        placeholder="Most Wanted"
        autoFocus
      />
      <TextField
        label="Address"
        value={draft.slug}
        onChange={(event) => draft.setSlug(event.target.value)}
        pattern={SLUG_INPUT_PATTERN}
        maxLength={63}
        spellCheck={false}
        placeholder={draft.address || 'most-wanted'}
        hint={<AddressHint address={draft.address} chosen={draft.slug.trim() !== ''} />}
      />
      {error !== undefined && <Notice tone="error">{friendlyMessage(error)}</Notice>}
      <div className="flex flex-col items-center gap-3 pt-1">
        <Button
          type="submit"
          tone="primary"
          size="lg"
          busy={busy}
          disabled={draft.name.trim() === ''}
          trailingIcon={ArrowRight}
          className="w-full"
        >
          {stage === 'logo'
            ? 'Adding the logo…'
            : stage === 'creating'
              ? 'Creating the company…'
              : 'Create company'}
        </Button>
        {cancel}
      </div>
    </form>
  );
}
