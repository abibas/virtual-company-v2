import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import type { NavItem } from './Rail.tsx';

const ITEM =
  'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-2xs font-semibold';

/** The bottom bar on phones: the pages of the rail that exist, with their names. */
export function MobileNav({ items }: { readonly items: readonly NavItem[] }) {
  return (
    <nav
      aria-label="Company pages"
      className="fixed inset-x-3 bottom-3 z-30 flex gap-1 rounded-2xl bg-glass p-1.5 shadow-raised ring-1 ring-line backdrop-blur-md md:hidden"
    >
      {items
        .filter((item) => item.href !== undefined && !item.soon && !item.railOnly)
        .map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              to={item.href ?? '/'}
              aria-current={item.active ? 'page' : undefined}
              className={cx(ITEM, item.active ? 'bg-blue-soft text-blue' : 'text-dim hover:text-ink')}
            >
              <Icon size={20} strokeWidth={item.active ? 2.5 : 2} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
    </nav>
  );
}
