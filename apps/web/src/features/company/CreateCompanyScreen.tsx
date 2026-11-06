import type { ReactNode } from 'react';
import type { Company } from '../../api/types.ts';
import { AuthSplit } from '../../components/auth/AuthSplit.tsx';
import { Brand } from '../../components/layout/Brand.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { CompanyShowcase } from './CompanyShowcase.tsx';
import { CreateCompanyForm } from './CreateCompanyForm.tsx';
import { type DraftStart, useCompanyDraft } from './draft.ts';

export interface CreateCompanyScreenProps {
  readonly email: string;
  /** The person's name for "Signed in as" (their email when left out). */
  readonly name?: string | undefined;
  readonly imageUrl?: string | null | undefined;
  /** The person's first company: the onboarding words, and the other way in (an invitation) below the card. */
  readonly first: boolean;
  readonly onCreated: (company: Company) => Promise<void>;
  /** Top right, beside the theme toggle: the account menu. */
  readonly corner?: ReactNode;
  /** A way back, under the button. */
  readonly cancel?: ReactNode;
  /** What the draft starts with (the gallery's sample). */
  readonly start?: DraftStart;
}

const JOINING =
  'Joining a company that already exists? Ask one of its admins for an invitation: its link signs you in and adds you to the company.';

/**
 * The create-company page: the form card (logo, name, address) on one side and the company's live preview on the
 * other; on phones the preview follows the card.
 */
export function CreateCompanyScreen({
  email,
  name = email,
  imageUrl,
  first,
  onCreated,
  corner,
  cancel,
  start,
}: CreateCompanyScreenProps) {
  const draft = useCompanyDraft(start);
  return (
    <AuthSplit
      panel={<CompanyShowcase draft={draft} />}
      strip={
        <div className="mb-6 w-full max-w-md lg:hidden">
          <Brand plain />
        </div>
      }
      corner={corner}
      footer={first ? JOINING : undefined}
    >
      <Card padding="lg" className="w-full">
        <h1 className="text-xl font-extrabold tracking-[-0.02em] text-ink">
          {first ? 'Create your company' : 'Create a company'}
        </h1>
        <p className="mt-1 text-sm text-dim">
          Name it and give it a logo. You become its owner; all of it can change later.
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-dim">
          <Avatar name={name} src={imageUrl} size="xs" tone="gradient" />
          <span className="min-w-0 truncate">
            Signed in as <span className="font-semibold text-ink-2">{name}</span>
          </span>
        </p>
        <CreateCompanyForm className="mt-6" draft={draft} onCreated={onCreated} cancel={cancel} />
      </Card>
      <CompanyShowcase draft={draft} className="mt-6 w-full lg:hidden" />
    </AuthSplit>
  );
}
