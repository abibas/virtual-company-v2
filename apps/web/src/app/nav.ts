import {
  Inbox,
  KeyRound,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  Network,
  Server,
  Settings,
} from 'lucide-react';
import type { NavItem } from '../components/layout/Rail.tsx';

/** A company page's address from its section, the first part of the path after `/:slug/` ('' for Overview). */
export type SectionHref = (section: string) => string;

/**
 * A company page's address, the one place every company link is built: `/<slug>` for its Overview, `/<slug>/<path>`
 * for the rest (`structure/people`, `agents/new`). A slug is never one of the app's own first segments (`RESERVED_SLUGS`).
 */
export const companyPath = (slug: string, path = ''): string => (path ? `/${slug}/${path}` : `/${slug}`);

/** The addresses of a company's pages: `/:slug` and `/:slug/<section>`. */
export const companyHrefs =
  (slug: string): SectionHref =>
  (section) =>
    companyPath(slug, section);

/** The address an old company link (`/c/<slug>/...`, before 2026-11-05) opens now: the same without `/c`. */
export function withoutOldPrefix(href: string): string {
  const rest = href.slice('/c'.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/**
 * The rail section a company path belongs to, from its first segment: an agent's page (`agents/...`) and its chats
 * (`chats/...`) are part of Company structure (`structure`); every other section is its own.
 */
export const railSection = (first: string): string =>
  first === 'agents' || first === 'chats' ? 'structure' : first;

/**
 * The new address of a company page that moved (2026-11-09), or undefined: `agents` (the org chart, or its list with
 * `?view=list`) and `members` are tabs of Company structure now.
 */
export function movedSection(section: string, search: URLSearchParams): string | undefined {
  if (section === 'members') return 'structure/people';
  if (section === 'agents') return search.get('view') === 'list' ? 'structure/agents' : 'structure';
  return undefined;
}

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
    page('structure', 'Company structure', Network),
    page('machines', 'Machines', Server),
    page('api-keys', 'API keys', KeyRound),
    page('settings', 'Settings', Settings),
    { key: 'tasks', label: 'Tasks', icon: ListChecks, soon: 'coming in S5' },
    { key: 'inbox', label: 'Inbox', icon: Inbox, soon: 'coming in S6' },
  ];
}
