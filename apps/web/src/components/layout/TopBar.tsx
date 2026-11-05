import { Bell, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { Menu, MenuSeparator } from '../forms/Menu.tsx';
import { SearchBox } from '../forms/SearchBox.tsx';
import { Avatar } from '../ui/Avatar.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { BrandMark } from './Brand.tsx';
import { dateLine, greetingFor } from './greeting.ts';

export interface ShellUser {
  /** Their full name, or their email while they have not given a name. */
  readonly name: string;
  readonly email?: string | undefined;
  readonly role?: string | undefined;
  /** Their photo; their initials on the brand gradient without one. */
  readonly imageUrl?: string | null | undefined;
  /** The account menu's items (`MenuItem`s): their profile, the sign-in service's account page, signing out. */
  readonly menu: ReactNode;
}

/** Who the menu belongs to, above its items: the name and the email (once, when the name is the email). */
function MenuHead({ user }: { readonly user: ShellUser }) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2">
      <Avatar name={user.name} src={user.imageUrl} size="md" tone="gradient" />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">{user.name}</p>
        {user.email && user.email !== user.name && <p className="truncate text-xs text-dim">{user.email}</p>}
      </div>
    </div>
  );
}

/**
 * The signed-in person: their photo (or initials) with their name and role beside it, a button that opens their
 * account menu. `compact` (outside a company, beside the theme toggle) shows the avatar alone; so do phones.
 */
export function UserPill({
  user,
  compact = false,
}: {
  readonly user: ShellUser;
  readonly compact?: boolean;
}) {
  return (
    <Menu
      align="end"
      width="w-64"
      trigger={(props) => (
        <button
          type="button"
          aria-label={`Account menu of ${user.name}`}
          {...props}
          className={cx(
            'flex cursor-pointer items-center gap-2.5 rounded-full bg-surface shadow-card transition-colors hover:bg-surface-2',
            compact ? 'p-1' : 'py-1 pr-2.5 pl-1 sm:pr-3',
          )}
        >
          <Avatar name={user.name} src={user.imageUrl} size="sm" tone="gradient" />
          {!compact && (
            <span className="hidden max-w-44 min-w-0 text-left sm:block">
              <span className="block truncate text-sm leading-tight font-bold text-ink">{user.name}</span>
              {user.role && (
                <span className="block truncate text-xs leading-tight text-dim">{user.role}</span>
              )}
            </span>
          )}
          {!compact && (
            <ChevronDown size={15} aria-hidden="true" className="hidden shrink-0 text-dim sm:block" />
          )}
        </button>
      )}
    >
      <MenuHead user={user} />
      <MenuSeparator />
      {user.menu}
    </Menu>
  );
}

/** The date and the greeting, the search box, the bell with its count, and the person. */
export function TopBar({
  firstName,
  now,
  user,
  attentionCount,
  attentionPulse = false,
  onBell,
}: {
  readonly firstName: string;
  readonly now?: Date;
  readonly user: ShellUser;
  readonly attentionCount: number;
  /** The bell's count pulses (below 80rem, where no right rail shows it). */
  readonly attentionPulse?: boolean;
  /** Opens what needs attention. */
  readonly onBell: () => void;
}) {
  return (
    <header className="flex items-center gap-3 px-4 pt-4 md:gap-5 md:px-6 md:pt-5">
      <BrandMark size="md" className="md:hidden" />
      <div className="min-w-0 flex-1 md:flex-none">
        <p className="hidden text-xs font-medium text-dim md:block">{dateLine(now)}</p>
        <h1 className="truncate text-lg font-extrabold tracking-[-0.02em] text-ink md:text-xl">
          {greetingFor(now)}, {firstName}
        </h1>
      </div>
      <SearchBox className="mx-auto hidden w-full max-w-md md:flex" />
      <div className="flex shrink-0 items-center gap-2.5">
        <IconButton
          label={attentionCount > 0 ? `Attention required: ${attentionCount}` : 'Attention required'}
          icon={Bell}
          tone="solid"
          size="lg"
          badge={attentionCount}
          pulse={attentionPulse}
          onClick={onBell}
          className="rounded-full"
        />
        <UserPill user={user} />
      </div>
    </header>
  );
}
