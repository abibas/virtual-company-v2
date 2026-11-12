import { type ReactNode, useEffect, useMemo } from 'react';
import { primeCompanyLogo } from '../../api/images/company-logo.ts';
import { CompanySwitcher } from '../../app/CompanySwitcher.tsx';
import { companyNav } from '../../app/nav.ts';
import { useLocation } from '../../app/router.tsx';
import { type Session, SessionContext } from '../../app/session.tsx';
import { MenuItem } from '../../components/forms/Menu.tsx';
import { AppShell } from '../../components/layout/AppShell.tsx';
import type { ShellUser } from '../../components/layout/TopBar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { SAMPLE_COMPANY, SAMPLE_MEMBERSHIP, SAMPLE_SESSION } from './records.ts';
import { SAMPLE_LOGO_SRC, SAMPLE_NOW } from './sample.ts';
import { useSampleRail } from './sample-rail.tsx';

/** The version the sample company's logo is primed under with `?logo=1` (the hook asks for it; the gallery has no API). */
export const SAMPLE_LOGO_VERSION = 'sample';

export type MockPage = 'dashboard' | 'org' | 'flows' | 'members' | 'api-keys' | 'settings';

/** The mock page of each section of the real company pages, so the rail is the company's own, pointing here. */
const MOCK_PATHS: Readonly<Record<string, string>> = {
  '': '/design/dashboard',
  structure: '/design/org',
  flows: '/design/flows',
  'api-keys': '/design/api-keys',
  settings: '/design/settings',
};

/** The section of the real company pages each mock page stands for (the switcher keeps it across companies). */
const SECTIONS: Readonly<Record<MockPage, string>> = {
  dashboard: '',
  org: 'structure',
  flows: 'flows',
  members: 'structure',
  'api-keys': 'api-keys',
  settings: 'settings',
};

const USER: ShellUser = {
  name: 'Ihor Herasko',
  email: 'ihor@example.com',
  role: 'Owner',
  menu: (
    <>
      <MenuItem onSelect={() => undefined}>Your profile (sample)</MenuItem>
      <MenuItem onSelect={() => undefined}>Manage account (sample)</MenuItem>
      <MenuItem onSelect={() => undefined}>Sign out (sample)</MenuItem>
    </>
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

/**
 * The app shell with sample data around a mocked page: the real switcher on the sample session, the right rail full
 * (`?inbox=empty`: with nothing in it).
 */
export function MockShell({ active, children }: { readonly active: MockPage; readonly children: ReactNode }) {
  const { search } = useLocation();
  const { session, current } = useSampleSession(search.get('logo') === '1');
  const rail = useSampleRail(search.get('inbox') === 'empty');
  return (
    <SessionContext value={session}>
      <AppShell
        nav={companyNav((section) => MOCK_PATHS[section] ?? '/design', SECTIONS[active])}
        badge={<CompanySwitcher current={current} section={SECTIONS[active]} />}
        firstName="Ihor"
        now={SAMPLE_NOW}
        user={USER}
        {...rail}
        banner={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="input" variant="solid">
              Sample data
            </Badge>
            <p className="text-sm text-dim">
              Nothing here is real: the inbox, the agents, the people and the numbers are made up for the
              design.
            </p>
          </div>
        }
      >
        {children}
      </AppShell>
    </SessionContext>
  );
}
