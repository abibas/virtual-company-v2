import { BrandPanel } from '../../components/auth/BrandPanel.tsx';
import { CompanyPreview } from './CompanyPreview.tsx';
import type { CompanyDraft } from './draft.ts';
import { NextSteps } from './NextSteps.tsx';

export const SHOWCASE_TITLE = 'Give your company a face.';
export const SHOWCASE_LINE =
  'What you type is how it looks in the rail, in the switcher and on its home. All of it can change later.';

/** The gradient side of the create-company page: the live preview of the company, then what comes next. */
export function CompanyShowcase({
  draft,
  className,
}: {
  readonly draft: Pick<CompanyDraft, 'name' | 'address' | 'logo'>;
  readonly className?: string;
}) {
  return (
    <BrandPanel title={SHOWCASE_TITLE} line={SHOWCASE_LINE} className={className}>
      <CompanyPreview name={draft.name} address={draft.address} logoSrc={draft.logo?.url ?? null} />
      <NextSteps className="mt-9" />
    </BrandPanel>
  );
}
