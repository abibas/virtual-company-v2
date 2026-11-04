import { Plus } from 'lucide-react';
import type { Membership } from '../api/types.ts';
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  type MenuTriggerProps,
} from '../components/forms/Menu.tsx';
import { roleName } from '../components/ui/Badge.tsx';
import { Tooltip } from '../components/ui/Tooltip.tsx';
import { useSession } from './session.tsx';

/** The company's badge at the top of the rail: its initial on the blue gradient; it opens the switcher. */
export function CompanyBadge({ name, ...trigger }: MenuTriggerProps & { readonly name: string }) {
  return (
    <Tooltip label={name} side="right">
      <button
        {...trigger}
        type="button"
        aria-label={`Company: ${name}. Switch company`}
        className="gradient-mark inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-md font-extrabold text-white shadow-primary transition-transform duration-150 hover:scale-105"
      >
        {name.trim().slice(0, 1).toUpperCase() || '?'}
      </button>
    </Tooltip>
  );
}

/**
 * The company on screen, and a menu of the person's other companies to switch to (on the same page of the other
 * company) or to create one.
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
        <MenuItem
          key={company.companyId}
          href={`/c/${company.slug}${section ? `/${section}` : ''}`}
          current={company.slug === current.slug}
          trailing={roleName(company.role)}
          {...(company.companyStatus !== 'active' ? { description: 'Being set up' } : {})}
        >
          {company.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem href="/companies/new" icon={Plus} tone="accent">
        Create company
      </MenuItem>
    </Menu>
  );
}
