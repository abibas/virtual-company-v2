import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { iconButtonClass, iconSize } from '../ui/IconButton.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly href?: string;
  readonly active?: boolean;
  /** Not built yet: shown muted with this note ("Coming in S2"). */
  readonly soon?: string;
}

/** One item of the rail: a link, the active one a filled blue square, a future one muted with its note. */
function RailItem({ item }: { readonly item: NavItem }) {
  const Icon = item.icon;
  const label = item.soon ? `${item.label}: ${item.soon}` : item.label;
  const classes = iconButtonClass({ size: 'lg', active: item.active ?? false });
  return (
    <li>
      <Tooltip label={label} side="right">
        {item.href !== undefined && !item.soon ? (
          <Link
            to={item.href}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            className={classes}
          >
            <Icon size={iconSize('lg')} strokeWidth={2} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" aria-disabled="true" aria-label={label} className={classes}>
            <Icon size={iconSize('lg')} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </Tooltip>
    </li>
  );
}

/**
 * The left rail, a white column floating on the canvas: the company badge on top (the switcher), the pages as
 * icons, and the theme toggle at the bottom. Hidden on phones, where `MobileNav` takes over.
 */
export function Rail({
  badge,
  items,
  className,
}: {
  readonly badge: ReactNode;
  readonly items: readonly NavItem[];
  readonly className?: string;
}) {
  return (
    <div
      className={cx(
        'fixed top-3 bottom-3 left-3 z-30 hidden w-16 flex-col items-center rounded-2xl bg-surface py-3 shadow-card md:flex',
        className,
      )}
    >
      <div className="flex items-center justify-center">{badge}</div>
      <nav aria-label="Company pages" className="mt-5 flex-1">
        <ul className="flex flex-col items-center gap-1.5">
          {items.map((item) => (
            <RailItem key={item.key} item={item} />
          ))}
        </ul>
      </nav>
      <ThemeToggle tooltip="right" />
    </div>
  );
}
