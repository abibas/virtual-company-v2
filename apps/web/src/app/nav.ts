import { Bot, Inbox, KeyRound, LayoutGrid, ListChecks, type LucideIcon, Settings, Users } from 'lucide-react';
import type { NavItem } from '../components/layout/Rail.tsx';

/** A company page's address from its section, the first part of the path after `/c/:slug/` ('' for Overview). */
export type SectionHref = (section: string) => string;

/** The addresses of a company's pages: `/c/:slug` and `/c/:slug/<section>`. */
export const companyHrefs =
  (slug: string): SectionHref =>
  (section) =>
    section ? `/c/${slug}/${section}` : `/c/${slug}`;

/**
 * The rail of a company: its pages (the one of `section` current), then the ones of later stages shown muted with
 * their note. `hrefOf` places them: the company's routes, or the design gallery's mocks.
 */
export function companyNav(hrefOf: SectionHref, section: string): readonly NavItem[] {
  const page = (key: string, label: string, icon: LucideIcon): NavItem => {
    const path = key === 'overview' ? '' : key;
    return { key, label, icon, href: hrefOf(path), active: section === path };
  };
  return [
    page('overview', 'Overview', LayoutGrid),
    page('agents', 'Agents', Bot),
    page('members', 'Members', Users),
    page('api-keys', 'API keys', KeyRound),
    page('settings', 'Settings', Settings),
    { key: 'tasks', label: 'Tasks', icon: ListChecks, soon: 'coming in S4' },
    { key: 'inbox', label: 'Inbox', icon: Inbox, soon: 'coming in S5' },
  ];
}
