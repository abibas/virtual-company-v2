import { roleAtLeast } from '@mwc/shared/roles';
import { removeCompanyLogo, uploadCompanyLogo, useCompanyLogo } from '../../api/company-logo.ts';
import { useApi } from '../../api/context.ts';
import type { Membership } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { companyPath } from '../../app/nav.ts';
import { navigate } from '../../app/router.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { CompanyDetailsForm } from '../../components/settings/CompanyDetailsForm.tsx';
import { CompanyLogoPanel } from '../../components/settings/CompanyLogoPanel.tsx';
import { DeleteCompany } from '../../components/settings/DeleteCompany.tsx';
import { roleName } from '../../components/ui/Badge.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

/** The logo panel on the real API: the current logo through the shared hook, uploads and removals as the member. */
function LogoSettings({
  membership,
  admin,
  reload,
}: {
  readonly membership: Membership;
  readonly admin: boolean;
  readonly reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const { companyId } = membership;
  const logoSrc = useCompanyLogo(companyId, membership.logo?.version);
  return (
    <CompanyLogoPanel
      name={membership.name}
      logoSrc={logoSrc}
      canChange={admin}
      onUpload={async (logo) => {
        await uploadCompanyLogo(api, companyId, logo.blob);
        await reload();
      }}
      onRemove={async () => {
        await removeCompanyLogo(api, companyId);
        await reload();
      }}
    />
  );
}

/** The name and address as everyone but admins and owners sees them. */
function DetailsReadOnly({ membership }: { readonly membership: Membership }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-dim">Name</dt>
      <dd className="font-medium text-ink">{membership.name}</dd>
      <dt className="text-dim">Address</dt>
      <dd className="font-mono text-xs text-ink-2">/{membership.slug}</dd>
    </dl>
  );
}

/**
 * `/:slug/settings`: the logo, the name and the address (admins and owners change them) and deleting the company
 * (owners).
 */
export function SettingsPage() {
  const { membership, reload } = useCompany();
  const { companyId, role } = membership;
  const admin = roleAtLeast(role, 'admin');

  return (
    <>
      <PageHeader title="Settings">
        <p>
          {admin
            ? 'The company’s logo, name and address.'
            : `The company’s logo, name and address. As ${roleName(role).toLowerCase()} you can see them; admins and owners change them.`}
        </p>
      </PageHeader>
      <div className="grid gap-4 md:gap-5">
        <LogoSettings membership={membership} admin={admin} reload={reload} />
        <Panel
          title="Name and address"
          description="The address is the company's place in every link: /<address>."
        >
          {admin ? (
            <CompanyDetailsForm
              companyId={companyId}
              name={membership.name}
              slug={membership.slug}
              onSaved={async (company) => {
                if (company.slug !== membership.slug)
                  navigate(companyPath(company.slug, 'settings'), { replace: true });
                await reload();
              }}
            />
          ) : (
            <DetailsReadOnly membership={membership} />
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
