import { BookUser, Bot, type LucideIcon, Network, Plus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tabs } from '../../components/forms/Segmented.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import type { StructureLinks } from '../agents/links.ts';

/** The tabs of the Company structure page. */
export type StructureTab = 'chart' | 'agents' | 'people' | 'contacts';

interface TabDef {
  readonly tab: StructureTab;
  /** The tab's part of the address after `/:slug/structure/` ('' for the org chart). */
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly href: (links: StructureLinks) => string;
}

/** The tabs in their order; a later one (costs) is one more entry here, its link and its body. */
const TABS: readonly TabDef[] = [
  { tab: 'chart', path: '', label: 'Org chart', icon: Network, href: (links) => links.chart },
  { tab: 'agents', path: 'agents', label: 'Agents', icon: Bot, href: (links) => links.list },
  { tab: 'people', path: 'people', label: 'People', icon: Users, href: (links) => links.people },
  { tab: 'contacts', path: 'contacts', label: 'Contacts', icon: BookUser, href: (links) => links.contacts },
];

/** The tab at `path` (the address after `/:slug/structure/`), or undefined when there is none. */
export const structureTabAt = (path: string): StructureTab | undefined =>
  TABS.find((t) => t.path === path)?.tab;

/**
 * The Company structure page: one compact row with the tabs, the tab's own controls (the org chart's flow picker) and,
 * for admins and owners beside the chart and the agents, Hire an agent; then the current tab's body. The company's
 * route and the design gallery both render it.
 */
export function StructureView({
  tab,
  links,
  hireHref,
  admin,
  hidden = [],
  tools,
  children,
}: {
  readonly tab: StructureTab;
  readonly links: StructureLinks;
  /** The hire form; the People tab has its own invitation form instead, and Contacts none. */
  readonly hireHref: string;
  readonly admin: boolean;
  /** Tabs the person may not open (a viewer's Contacts). */
  readonly hidden?: readonly StructureTab[];
  /** The tab's own controls, before Hire (the org chart's flow picker). */
  readonly tools?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      {/* One compact row (Ihor: no title or lede eating the chart's space): the tabs, the tab's controls, Hire. */}
      <h1 className="sr-only">Company structure</h1>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          label="Company structure views"
          items={TABS.filter((t) => !hidden.includes(t.tab)).map((t) => ({
            href: t.href(links),
            label: t.label,
            icon: t.icon,
            current: t.tab === tab,
          }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          {tools}
          {admin && (tab === 'chart' || tab === 'agents') && (
            <ButtonLink href={hireHref} tone="primary" size="sm" icon={Plus}>
              Hire an agent
            </ButtonLink>
          )}
        </div>
      </div>
      {children}
    </>
  );
}
