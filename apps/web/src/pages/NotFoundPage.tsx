import { PlainShell } from '../app/PlainShell.tsx';
import { Link } from '../app/router.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';

/** Any address this app does not have. */
export function NotFoundPage() {
  return (
    <PlainShell>
      <PageHeader title="Page not found">
        <p>There is nothing at this address.</p>
      </PageHeader>
      <Link to="/" className="text-amber underline underline-offset-4">
        Open your companies
      </Link>
    </PlainShell>
  );
}
