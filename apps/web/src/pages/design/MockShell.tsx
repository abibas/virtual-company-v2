import { Bot, Inbox, KeyRound, LayoutGrid, ListChecks, Settings, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { primeCompanyLogo } from '../../api/company-logo.ts';
import { CompanySwitcher } from '../../app/CompanySwitcher.tsx';
import { useLocation } from '../../app/router.tsx';
import { type Session, SessionContext } from '../../app/session.tsx';
import { AppShell } from '../../components/layout/AppShell.tsx';
import type { NavItem } from '../../components/layout/Rail.tsx';
import type { ShellUser } from '../../components/layout/TopBar.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { SAMPLE_COMPANY, SAMPLE_MEMBERSHIP, SAMPLE_SESSION } from './records.ts';
import { SAMPLE_AGENTS, SAMPLE_ATTENTION, SAMPLE_LOGO_SRC, SAMPLE_NOW } from './sample.ts';

/** The version the sample company's logo is primed under with `?logo=1` (the hook asks for it; the gallery has no API). */
export const SAMPLE_LOGO_VERSION = 'sample';

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

/**
 * The sample person's session: two companies, nothing to reload. With `?logo=1` the sample company carries a logo
 * version and the sample logo is primed under it, so the rail, the switcher and the hero show it.
 */
function useSampleSession(withLogo: boolean): {
  readonly session: Session;
  readonly current: typeof SAMPLE_MEMBERSHIP;
} {
  useEffect(() => {
    if (!withLogo) return;
    fetch(SAMPLE_LOGO_SRC)
      .then((response) => response.blob())
      .then((blob) => primeCompanyLogo(SAMPLE_COMPANY.id, SAMPLE_LOGO_VERSION, blob))
      .catch(() => undefined);
  }, [withLogo]);
  return useMemo(() => {
    const current = withLogo
      ? { ...SAMPLE_MEMBERSHIP, logo: { version: SAMPLE_LOGO_VERSION } }
      : SAMPLE_MEMBERSHIP;
    const me = { ...SAMPLE_SESSION, memberships: [current, ...SAMPLE_SESSION.memberships.slice(1)] };
    return {
      session: { me, reload: () => Promise.resolve(me), reconcile: () => Promise.resolve(me) },
      current,
    };
  }, [withLogo]);
}

const ATTENTION = SAMPLE_ATTENTION.map((item) => ({ ...item, href: '/design/dashboard' }));

/** The app shell with sample data around a mocked page: the real switcher on the sample session, the feed full. */
export function MockShell({ active, children }: { readonly active: MockPage; readonly children: ReactNode }) {
  const [created, setCreated] = useState<string>();
  const { search } = useLocation();
  const { session, current } = useSampleSession(search.get('logo') === '1');
  return (
    <SessionContext value={session}>
      <AppShell
        nav={nav(active)}
        badge={<CompanySwitcher current={current} section={SECTIONS[active]} />}
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
