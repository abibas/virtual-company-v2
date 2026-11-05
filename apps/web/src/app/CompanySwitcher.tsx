import { Plus } from 'lucide-react';
import type { Membership } from '../api/types.ts';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/forms/Menu.tsx';
import { CompanyBadge } from '../components/layout/Rail.tsx';
import { roleName } from '../components/ui/Badge.tsx';
import { CompanyLogo } from '../components/ui/CompanyLogo.tsx';
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
  return (
    <MenuItem
      href={`/c/${company.slug}${section ? `/${section}` : ''}`}
      current={current}
      leading={<CompanyLogo name={company.name} size="sm" />}
      trailing={roleName(company.role)}
      {...(company.companyStatus !== 'active' ? { description: 'Being set up' } : {})}
    >
      {company.name}
    </MenuItem>
  );
}

/**
 * The company on screen as the rail's badge, and a menu of the person's other companies to switch to (on the same
 * page of the other company) or to create one.
 */
export function CompanySwitcher({
  current,
  section,
}: {
  readonly current: Membership;
  readonly section: string;
}) {
  const { me } = useSession();
  const companies = me.memberships.filter((membership) => membership.status === 'active');
  return (
    <Menu trigger={(props) => <CompanyBadge name={current.name} {...props} />} width="w-72">
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
