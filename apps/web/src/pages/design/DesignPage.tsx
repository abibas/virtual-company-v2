import { useEffect } from 'react';
import { useLocation } from '../../app/router.tsx';
import { setThemeChoice } from '../../app/theme.ts';
import { Tabs } from '../../components/forms/Segmented.tsx';
import { Brand } from '../../components/layout/Brand.tsx';
import { ThemeToggle } from '../../components/layout/ThemeToggle.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { DashboardMock } from './DashboardMock.tsx';
import { FlowsMock } from './flows/FlowsMock.tsx';
import { BadgesSection } from './gallery/Badges.tsx';
import { ButtonsSection } from './gallery/Buttons.tsx';
import { CardsSection } from './gallery/Cards.tsx';
import { ComposersSection } from './gallery/Composers.tsx';
import { FormsSection } from './gallery/Forms.tsx';
import { ListsSection } from './gallery/Lists.tsx';
import { NewCompanyMock } from './NewCompanyMock.tsx';
import { OrgMock } from './OrgMock.tsx';
import { PagesMock } from './PagesMock.tsx';
import { SignInMock } from './SignInMock.tsx';
import { SubscriptionsMock } from './SubscriptionsMock.tsx';

const VIEWS = [
  { href: '/design', label: 'Components' },
  { href: '/design/dashboard', label: 'Dashboard' },
  { href: '/design/org', label: 'Company structure' },
  { href: '/design/flows', label: 'Flows' },
  { href: '/design/members', label: 'People' },
  { href: '/design/api-keys', label: 'API keys' },
  { href: '/design/settings', label: 'Settings' },
  { href: '/design/subscriptions', label: 'Subscriptions' },
  { href: '/design/sign-in', label: 'Sign-in' },
  { href: '/design/new-company', label: 'New company' },
] as const;

const SECTIONS = [
  ['buttons', 'Buttons'],
  ['cards', 'Cards'],
  ['badges', 'Badges and avatars'],
  ['forms', 'Forms'],
  ['lists', 'Lists and feed'],
  ['composer', 'Composer'],
] as const;

function ViewTabs({ pathname, size }: { readonly pathname: string; readonly size: 'sm' | 'md' }) {
  return (
    <Tabs
      label="Design views"
      size={size}
      items={VIEWS.map((view) => ({ ...view, current: view.href === pathname }))}
      className="max-w-full overflow-x-auto"
    />
  );
}

/** The components view: the toolbar, a short index, then every component in its states. */
function Components({ pathname }: { readonly pathname: string }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 md:px-6">
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-3 bg-canvas/85 px-4 py-3 backdrop-blur-md md:-mx-6 md:px-6">
        <Brand />
        <Badge tone="input" variant="solid">
          Sample data
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <ViewTabs pathname={pathname} size="sm" />
          <ThemeToggle tone="solid" />
        </div>
      </header>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-extrabold tracking-[-0.025em] text-ink">Design gallery</h1>
        <p className="mt-1 max-w-prose text-sm text-dim">
          Every reusable component of the web app in its states, from{' '}
          <span className="font-mono text-xs">apps/web/src/components</span>. Development only.
        </p>
        <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-2">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-2 shadow-card hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-5">
        <ButtonsSection />
        <CardsSection />
        <BadgesSection />
        <FormsSection />
        <ListsSection />
        <ComposersSection />
      </div>
    </div>
  );
}

/** A floating way between the full-page mocks. */
function MockBar({ pathname }: { readonly pathname: string }) {
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-ink p-1.5 pl-3 text-canvas shadow-float max-md:bottom-24">
      <span className="shrink-0 text-xs font-semibold">Sample data</span>
      <ViewTabs pathname={pathname} size="sm" />
    </div>
  );
}

/** The full-page mock at this path, if any. */
function mockAt(pathname: string) {
  switch (pathname) {
    case '/design/dashboard':
      return <DashboardMock />;
    case '/design/org':
      return <OrgMock />;
    case '/design/flows':
      return <FlowsMock />;
    case '/design/members':
      return <PagesMock page="members" />;
    case '/design/api-keys':
      return <PagesMock page="api-keys" />;
    case '/design/settings':
      return <PagesMock page="settings" />;
    case '/design/subscriptions':
      return <SubscriptionsMock />;
    case '/design/sign-in':
      return <SignInMock />;
    case '/design/new-company':
      return <NewCompanyMock />;
    default:
      return null;
  }
}

/**
 * `/design` (development only, no API and no sign-in): the component gallery; the dashboard, the org chart (with the
 * agents' list, form and page), the flows (a team's board, its flow and editor, a task), Members, API keys and Settings pages in the shell with sample data; the home page's
 * Subscription limits widget on sample cards; the sign-in layout with a stand-in for Clerk; the create-company page.
 * `?theme=dark` (or light) picks the scheme, so a screenshot run can ask for either.
 */
export function DesignPage() {
  const { pathname, search } = useLocation();
  const theme = search.get('theme');
  useEffect(() => {
    if (theme === 'light' || theme === 'dark') setThemeChoice(theme);
  }, [theme]);
  const mock = mockAt(pathname);
  if (mock) {
    return (
      <>
        {mock}
        <MockBar pathname={pathname} />
      </>
    );
  }
  return <Components pathname={pathname} />;
}
