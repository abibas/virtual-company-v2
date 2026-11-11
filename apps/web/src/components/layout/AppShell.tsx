import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { Drawer } from './Drawer.tsx';
import { MobileNav } from './MobileNav.tsx';
import { type NavItem, Rail } from './Rail.tsx';
import type { RailView } from './RailViews.tsx';
import { RightRail, RightRailContent, type RightRailProps } from './RightRail.tsx';
import { useRightRail, useWideScreen } from './right-rail-state.ts';
import { type ShellUser, TopBar } from './TopBar.tsx';

export interface AppShellProps extends RightRailProps {
  readonly nav: readonly NavItem[];
  /** The rail's top badge: the company switcher. */
  readonly badge: ReactNode;
  readonly firstName: string;
  readonly user: ShellUser;
  /** A notice above the page (the company being set up). */
  readonly banner?: ReactNode;
  readonly now?: Date | undefined;
  readonly children: ReactNode;
}

/**
 * The frame of every company page: the left icon rail, the top bar, the page, and the right rail with its two views,
 * Attention (the inbox and the quick-create dock) and Notifications. From 80rem the right rail opens beside the page or
 * collapses to a strip (`useRightRail`) whose icons open each view; below that the top bar's inbox button opens it as a
 * drawer. On phones the rail becomes a bottom bar.
 */
export function AppShell({ nav, badge, firstName, user, banner, children, now, ...rail }: AppShellProps) {
  const [drawer, setDrawer] = useState(false);
  const [view, setView] = useState<RailView>('attention');
  const aside = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  // A card or a notice opened from the drawer goes to its page: the drawer closes behind it.
  const { href } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the address changes.
  useEffect(() => setDrawer(false), [href]);
  const wide = useWideScreen();
  const right = useRightRail(rail.attentionCount);
  // The collapsed rail's "+" asks for the dock's focus; any other toggle withdraws the request.
  const [composing, setComposing] = useState(false);
  const setRailOpen = (open: boolean) => {
    setComposing(false);
    right.setOpen(open);
  };
  const onInbox = () => {
    if (!wide) {
      setDrawer(true);
      return;
    }
    setRailOpen(true);
    aside.current?.focus();
  };
  const onCompose = () => {
    setView('attention');
    setComposing(true);
    right.setOpen(true);
  };
  return (
    <div className="min-h-screen md:pl-rail">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 text-ink shadow-float focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <Rail badge={badge} items={nav} />
      <div className="flex min-h-screen">
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            firstName={firstName}
            user={user}
            attentionCount={rail.attentionCount}
            unread={rail.unread}
            onInbox={onInbox}
            {...(now !== undefined ? { now } : {})}
          />
          <main
            id="main"
            tabIndex={-1}
            className={cx('w-full flex-1 px-4 pt-5 pb-28 outline-none md:px-6 md:pt-6 md:pb-10')}
          >
            {banner && <div className="mb-5">{banner}</div>}
            {children}
          </main>
        </div>
        <RightRail
          asideRef={aside}
          open={right.open}
          onOpenChange={setRailOpen}
          view={view}
          onView={setView}
          onCompose={onCompose}
          composing={composing}
          {...rail}
        />
      </div>
      <MobileNav items={nav} />
      <Drawer open={drawer} onClose={closeDrawer} title="Inbox" className="h-[calc(100vh-1rem)]">
        <RightRailContent {...rail} view={view} onView={setView} />
      </Drawer>
    </div>
  );
}
