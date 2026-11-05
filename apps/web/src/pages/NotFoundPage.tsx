import type { ReactNode } from 'react';
import { PlainShell } from '../app/PlainShell.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';

/** Any address this app does not have; `children` say more than the plain line (an unknown company's address). */
export function NotFoundPage({ children }: { readonly children?: ReactNode }) {
  return (
    <PlainShell>
      <PageHeader title="Page not found">
        <p>{children ?? 'There is nothing at this address.'}</p>
      </PageHeader>
      <ButtonLink href="/" tone="primary">
        Open your companies
      </ButtonLink>
    </PlainShell>
  );
}
