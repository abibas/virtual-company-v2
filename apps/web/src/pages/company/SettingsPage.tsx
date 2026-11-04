import { roleAtLeast } from '@mwc/shared/roles';
import { useCompany } from '../../app/company.ts';
import { navigate } from '../../app/router.tsx';
import { CompanyDetailsForm } from '../../components/settings/CompanyDetailsForm.tsx';
import { DeleteCompany } from '../../components/settings/DeleteCompany.tsx';
import { roleName } from '../../components/ui/Badge.tsx';
import { PageHeader } from '../../components/ui/PageHeader.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

/** `/c/:slug/settings`: the name and address (admins and owners change them) and deleting the company (owners). */
export function SettingsPage() {
  const { membership, reload } = useCompany();
  const { companyId, role } = membership;
  const admin = roleAtLeast(role, 'admin');

  return (
    <>
      <PageHeader title="Settings">
        <p>
          {admin
            ? 'The company’s name and address.'
            : `The company’s name and address. As ${roleName(role).toLowerCase()} you can see them; admins and owners change them.`}
        </p>
      </PageHeader>
      <div className="flex flex-col gap-6">
        <Panel title="Name and address">
          {admin ? (
            <CompanyDetailsForm
              companyId={companyId}
              name={membership.name}
              slug={membership.slug}
              onSaved={async (company) => {
                if (company.slug !== membership.slug)
                  navigate(`/c/${company.slug}/settings`, { replace: true });
                await reload();
              }}
            />
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-[auto_1fr]">
              <dt className="text-dim">Name</dt>
              <dd className="text-ink">{membership.name}</dd>
              <dt className="text-dim">Address</dt>
              <dd className="font-mono text-[13px] text-ink-2">/c/{membership.slug}</dd>
            </dl>
          )}
        </Panel>
        {role === 'owner' && (
          <DeleteCompany
            companyId={companyId}
            name={membership.name}
            onDeleted={() => {
              void reload()
                .catch(() => undefined)
                .then(() => navigate('/', { replace: true }));
            }}
          />
        )}
      </div>
    </>
  );
}
