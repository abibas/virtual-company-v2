import { Bell } from 'lucide-react';
import type { ReactNode } from 'react';
import { SearchBox } from '../forms/SearchBox.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { BrandMark } from './Brand.tsx';
import { dateLine, greetingFor } from './greeting.ts';

export interface ShellUser {
  readonly name: string;
  readonly role?: string | undefined;
  /** The user menu (Clerk's `UserButton`), rendered as the chip's avatar. */
  readonly menu: ReactNode;
}

/** The person's avatar (their menu) with their name and role beside it. */
function UserChip({ user }: { readonly user: ShellUser }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-surface py-1 pr-3.5 pl-1.5 shadow-card">
      {user.menu}
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-sm leading-tight font-bold text-ink">{user.name}</p>
        {user.role && <p className="truncate text-xs leading-tight text-dim">{user.role}</p>}
      </div>
    </div>
  );
}

/** The date and the greeting, the search box, the bell with its count, and the person. */
export function TopBar({
  firstName,
  now,
  user,
  attentionCount,
  onBell,
}: {
  readonly firstName: string;
  readonly now?: Date;
  readonly user: ShellUser;
  readonly attentionCount: number;
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
          onClick={onBell}
          className="rounded-full"
        />
        <UserChip user={user} />
      </div>
    </header>
  );
}
