import { Bot, Inbox, KeyRound, LayoutGrid, ListChecks, Settings, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { CompanySwitcher } from '../../app/CompanySwitcher.tsx';
import { type Session, SessionContext } from '../../app/session.tsx';
import { AppShell } from '../../components/layout/AppShell.tsx';
import type { NavItem } from '../../components/layout/Rail.tsx';
import type { ShellUser } from '../../components/layout/TopBar.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { SAMPLE_MEMBERSHIP, SAMPLE_SESSION } from './records.ts';
import { SAMPLE_AGENTS, SAMPLE_ATTENTION, SAMPLE_NOW } from './sample.ts';

export type MockPage = 'dashboard' | 'members' | 'api-keys' | 'settings';

const nav = (active: MockPage): readonly NavItem[] => [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    href: '/design/dashboard',
    active: active === 'dashboard',
  },
  { key: 'members', label: 'Members', icon: Users, href: '/design/members', active: active === 'members' },
  {
    key: 'api-keys',
    label: 'API keys',
    icon: KeyRound,
    href: '/design/api-keys',
    active: active === 'api-keys',
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    href: '/design/settings',
    active: active === 'settings',
  },
  { key: 'agents', label: 'Agents', icon: Bot, soon: 'coming in S2' },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, soon: 'coming in S4' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, soon: 'coming in S5' },
];

/** The section of the real company pages each mock page stands for (the switcher keeps it across companies). */
const SECTIONS: Readonly<Record<MockPage, string>> = {
  dashboard: '',
  members: 'members',
  'api-keys': 'api-keys',
  settings: 'settings',
};

const USER: ShellUser = {
  name: 'Ihor Herasko',
  role: 'Owner',
  menu: (
    <button type="button" aria-label="Account menu (sample)" className="cursor-pointer rounded-full">
      <Avatar name="Ihor Herasko" size="sm" />
    </button>
  ),
};

/** The sample person's session: two companies, nothing to reload. */
const SESSION: Session = {
  me: SAMPLE_SESSION,
  reload: () => Promise.resolve(SAMPLE_SESSION),
  reconcile: () => Promise.resolve(SAMPLE_SESSION),
};

const ATTENTION = SAMPLE_ATTENTION.map((item) => ({ ...item, href: '/design/dashboard' }));

/** The app shell with sample data around a mocked page: the real switcher on the sample session, the feed full. */
export function MockShell({ active, children }: { readonly active: MockPage; readonly children: ReactNode }) {
  const [created, setCreated] = useState<string>();
  return (
    <SessionContext value={SESSION}>
      <AppShell
        nav={nav(active)}
        badge={<CompanySwitcher current={SAMPLE_MEMBERSHIP} section={SECTIONS[active]} />}
        firstName="Ihor"
        now={SAMPLE_NOW}
        user={USER}
        attention={ATTENTION}
        agents={SAMPLE_AGENTS}
        onQuickCreate={(agent, text) =>
          setCreated(`${SAMPLE_AGENTS.find((a) => a.id === agent)?.name}: ${text}`)
        }
        seeAllHref="/design/dashboard"
        banner={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="input" variant="solid">
              Sample data
            </Badge>
            <p className="text-sm text-dim">
              Nothing here is real: the feed, the agents, the people and the numbers are made up for the
              design.
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
        {children}
      </AppShell>
    </SessionContext>
  );
}
