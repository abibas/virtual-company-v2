import { Bot, type LucideIcon, Network, Plus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tabs } from '../../components/forms/Segmented.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import type { StructureLinks } from '../agents/links.ts';

/** The tabs of the Company structure page. */
export type StructureTab = 'chart' | 'agents' | 'people';

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
];

/** The tab at `path` (the address after `/:slug/structure/`), or undefined when there is none. */
export const structureTabAt = (path: string): StructureTab | undefined =>
  TABS.find((t) => t.path === path)?.tab;

const LEDE = {
  admin:
    'Who is in the company, people and agents, and who reports to whom. Hire agents, invite people and place everyone on the chart.',
  other: 'Who is in the company, people and agents, and who reports to whom.',
} as const;

/**
 * The Company structure page: its header (Hire an agent for admins and owners, beside the chart and the agents), the
 * tabs, and the current tab's body. The company's route and the design gallery both render it.
 */
export function StructureView({
  tab,
  links,
  hireHref,
  admin,
  children,
}: {
  readonly tab: StructureTab;
  readonly links: StructureLinks;
  /** The hire form; the People tab has its own invitation form instead. */
  readonly hireHref: string;
  readonly admin: boolean;
  readonly children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Company structure"
        actions={
          admin &&
          tab !== 'people' && (
            <ButtonLink href={hireHref} tone="primary" icon={Plus}>
              Hire an agent
            </ButtonLink>
          )
        }
      >
        <p>{admin ? LEDE.admin : LEDE.other}</p>
      </PageHeader>
      <Tabs
        label="Company structure views"
        className="mb-4"
        items={TABS.map((t) => ({
          href: t.href(links),
          label: t.label,
          icon: t.icon,
          current: t.tab === tab,
        }))}
      />
      {children}
    </>
  );
}
