import { Bot, Inbox, KeyRound, LayoutGrid, ListChecks, Settings, Users } from 'lucide-react';
import type { NavItem } from '../components/layout/Rail.tsx';

/** The rail of a company: its pages, and the ones of later stages shown muted with their note. */
export function companyNav(slug: string, section: string): readonly NavItem[] {
  const base = `/c/${slug}`;
  return [
    { key: 'overview', label: 'Overview', icon: LayoutGrid, href: base, active: section === '' },
    { key: 'members', label: 'Members', icon: Users, href: `${base}/members`, active: section === 'members' },
    {
      key: 'api-keys',
      label: 'API keys',
      icon: KeyRound,
      href: `${base}/api-keys`,
      active: section === 'api-keys',
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: Settings,
      href: `${base}/settings`,
      active: section === 'settings',
    },
    { key: 'agents', label: 'Agents', icon: Bot, soon: 'coming in S2' },
    { key: 'tasks', label: 'Tasks', icon: ListChecks, soon: 'coming in S4' },
    { key: 'inbox', label: 'Inbox', icon: Inbox, soon: 'coming in S5' },
  ];
}
