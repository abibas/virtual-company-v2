import { PlainShell } from '../app/PlainShell.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';

/** Any address this app does not have. */
export function NotFoundPage() {
  return (
    <PlainShell>
      <PageHeader title="Page not found">
        <p>There is nothing at this address.</p>
      </PageHeader>
      <ButtonLink href="/" tone="primary">
        Open your companies
      </ButtonLink>
    </PlainShell>
  );
}
