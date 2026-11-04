import { UserButton } from '@clerk/react';
import type { Membership } from '../api/types.ts';
import { Brand } from '../components/layout/Brand.tsx';
import { CompanySwitcher } from './CompanySwitcher.tsx';
import { Link } from './router.tsx';

const NAV = [
  { section: '', label: 'Overview' },
  { section: 'members', label: 'Members' },
  { section: 'api-keys', label: 'API keys' },
  { section: 'settings', label: 'Settings' },
] as const;

/** The company header: the brand, the company switcher, the user menu, and the company's pages. */
export function AppHeader({
  membership,
  section,
}: {
  readonly membership: Membership;
  readonly section: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ground/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-3 md:gap-3 md:px-8">
        <Brand />
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line-2" />
        <CompanySwitcher current={membership} section={section} />
        <div className="ml-auto flex shrink-0 items-center">
          <UserButton />
        </div>
      </div>
      <nav aria-label="Company" className="mx-auto max-w-5xl px-2 md:px-6">
        <ul className="flex overflow-x-auto">
          {NAV.map((item) => {
            const current = item.section === section;
            return (
              <li key={item.label}>
                <Link
                  to={`/c/${membership.slug}${item.section ? `/${item.section}` : ''}`}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-block border-b-2 px-2.5 pt-3 pb-2.5 text-[13.5px] font-medium whitespace-nowrap ${
                    current ? 'border-amber text-ink' : 'border-transparent text-dim hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
