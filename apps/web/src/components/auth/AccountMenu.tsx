import { useClerk } from '@clerk/react';
import { LogOut, Settings, Sparkles, UserRound } from 'lucide-react';
import type { Me } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { MenuItem, MenuSeparator } from '../forms/Menu.tsx';
import type { ShellUser } from '../layout/TopBar.tsx';
import { personName } from '../ui/Avatar.tsx';

/** Where the person changes their name and photo (`pages/ProfilePage.tsx`). */
export const PROFILE_PATH = '/profile';

/**
 * The items of the signed-in person's account menu: their profile here (name and photo), their AI subscriptions (the
 * current company's Subscriptions page, or the last company's outside one), the
 * sign-in service's own account page (email, sign-in methods, sessions) and signing out, back to the sign-in page.
 */
export function AccountMenuItems() {
  const clerk = useClerk();
  const subscriptions = usePersonalHref('subscriptions');
  return (
    <>
      <MenuItem href={PROFILE_PATH} icon={UserRound}>
        Your profile
      </MenuItem>
      <MenuItem href={subscriptions} icon={Sparkles} description="Claude, OpenAI, keys, gateways, profiles">
        Subscriptions
      </MenuItem>
      <MenuItem
        icon={Settings}
        description="Email, sign-in methods, sessions"
        onSelect={() => clerk.openUserProfile()}
      >
        Manage account
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={LogOut} onSelect={() => void clerk.signOut({ redirectUrl: '/sign-in' })}>
        Sign out
      </MenuItem>
    </>
  );
}

/** The signed-in person as the shells show them: their name (else email), photo, role there, and the account menu. */
export function shellUser(user: Me['user'], role?: string): ShellUser {
  return {
    name: personName(user.displayName, user.email),
    email: user.email,
    role,
    imageUrl: user.imageUrl,
    menu: <AccountMenuItems />,
  };
}
