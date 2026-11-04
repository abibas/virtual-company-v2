import { Bot, Inbox, KeyRound, LayoutGrid, ListChecks, Mail, Plus, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { StatTile } from '../../components/data/StatTile.tsx';
import { AppShell } from '../../components/layout/AppShell.tsx';
import type { NavItem } from '../../components/layout/Rail.tsx';
import type { ShellUser } from '../../components/layout/TopBar.tsx';
import { AgentsCard, RunsCard } from '../../components/overview/ComingCards.tsx';
import { CompanyFacts } from '../../components/overview/CompanyFacts.tsx';
import { CompanyHero } from '../../components/overview/CompanyHero.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { SAMPLE_AGENTS, SAMPLE_ATTENTION, SAMPLE_NOW } from './sample.ts';

const HERE = '/design/dashboard';

const NAV: readonly NavItem[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, href: HERE, active: true },
  { key: 'members', label: 'Members', icon: Users, href: HERE },
  { key: 'api-keys', label: 'API keys', icon: KeyRound, href: HERE },
  { key: 'settings', label: 'Settings', icon: Settings, href: HERE },
  { key: 'agents', label: 'Agents', icon: Bot, soon: 'coming in S2' },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, soon: 'coming in S4' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, soon: 'coming in S5' },
];

const USER: ShellUser = {
  name: 'Ihor Herasko',
  role: 'Owner',
  menu: (
    <button type="button" aria-label="Account menu (sample)" className="cursor-pointer rounded-full">
      <Avatar name="Ihor Herasko" size="sm" />
    </button>
  ),
};

const ATTENTION = SAMPLE_ATTENTION.map((item) => ({ ...item, href: HERE }));

/** The company badge the rail shows: the company's initial on the blue gradient. */
function MockBadge() {
  return (
    <button
      type="button"
      aria-label="Company: Most Wanted (sample)"
      className="gradient-mark inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-md font-extrabold text-white shadow-primary"
    >
      M
    </button>
  );
}

/** What the real Overview shows, with made-up numbers. */
function MockOverview() {
  return (
    <div className="grid gap-4 md:gap-5">
      <CompanyHero
        name="Most Wanted"
        status="active"
        summary="You own this company: you manage its people, its settings, and soon its agents."
        actions={
          <>
            <Button tone="inverse" icon={Plus}>
              Invite a teammate
            </Button>
            <Button tone="inverse-soft" icon={KeyRound}>
              Create an API key
            </Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Members"
          value={12}
          icon={Users}
          delta={{ value: '+2 this week', direction: 'up' }}
          href={HERE}
        />
        <StatTile
          label="Pending invitations"
          value={3}
          icon={Mail}
          tone="input"
          hint="Expire 14 days after they are sent"
          href={HERE}
        />
        <StatTile
          label="Your API keys"
          value={1}
          icon={KeyRound}
          tone="teal"
          hint="Active, expires in 82 days"
          href={HERE}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AgentsCard />
        <RunsCard />
      </div>
      <CompanyFacts
        email="ihor@example.com"
        slug="most-wanted"
        companyId="019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10"
      />
    </div>
  );
}

/** The whole shell with sample data: the feed full of every kind, agents in the dock, numbers on the tiles. */
export function DashboardMock() {
  const [created, setCreated] = useState<string>();
  return (
    <AppShell
      nav={NAV}
      badge={<MockBadge />}
      firstName="Ihor"
      now={SAMPLE_NOW}
      user={USER}
      attention={ATTENTION}
      agents={SAMPLE_AGENTS}
      onQuickCreate={(agent, text) =>
        setCreated(`${SAMPLE_AGENTS.find((a) => a.id === agent)?.name}: ${text}`)
      }
      seeAllHref={HERE}
      banner={
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="input" variant="solid">
            Sample data
          </Badge>
          <p className="text-sm text-dim">
            Nothing here is real: the feed, the agents and the numbers are made up for the design.
          </p>
        </div>
      }
    >
      {created && (
        <div className="mb-5">
          <Notice tone="success" title="Sample only" onDismiss={() => setCreated(undefined)}>
            Would create a task for {created}.
          </Notice>
        </div>
      )}
      <MockOverview />
    </AppShell>
  );
}
