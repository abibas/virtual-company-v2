import { Plus } from 'lucide-react';
import { useCompanyLogo } from '../api/company-logo.ts';
import type { Membership } from '../api/types.ts';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/forms/Menu.tsx';
import { CompanyBadge } from '../components/layout/Rail.tsx';
import { roleName } from '../components/ui/Badge.tsx';
import { CompanyLogo } from '../components/ui/CompanyLogo.tsx';
import { companyPath } from './nav.ts';
import { useSession } from './session.tsx';

/** One company of the menu: its logo, its name, the person's role there, on the same page of that company. */
function CompanyItem({
  company,
  current,
  section,
}: {
  readonly company: Membership;
  readonly current: boolean;
  readonly section: string;
}) {
  const src = useCompanyLogo(company.companyId, company.logo?.version);
  return (
    <MenuItem
      href={companyPath(company.slug, section)}
      current={current}
      leading={<CompanyLogo name={company.name} src={src} size="sm" />}
      trailing={roleName(company.role)}
      {...(company.companyStatus !== 'active' ? { description: 'Being set up' } : {})}
    >
      {company.name}
    </MenuItem>
  );
}

/**
 * The company on screen as the rail's badge (its logo, or its initials), and a menu of the person's other companies
 * to switch to (on the same page of the other company) or to create one.
 */
export function CompanySwitcher({
  current,
  section,
}: {
  readonly current: Membership;
  readonly section: string;
}) {
  const { me } = useSession();
  const src = useCompanyLogo(current.companyId, current.logo?.version);
  const companies = me.memberships.filter((membership) => membership.status === 'active');
  return (
    <Menu trigger={(props) => <CompanyBadge name={current.name} src={src} {...props} />} width="w-72">
      <MenuLabel>Your companies</MenuLabel>
      {companies.map((company) => (
        <CompanyItem
          key={company.companyId}
          company={company}
          current={company.slug === current.slug}
          section={section}
        />
      ))}
      <MenuSeparator />
      <MenuItem href="/companies/new" icon={Plus} tone="accent">
        Create company
      </MenuItem>
    </Menu>
  );
}
