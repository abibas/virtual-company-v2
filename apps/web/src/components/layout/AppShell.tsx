import { type ReactNode, useCallback, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { Drawer } from './Drawer.tsx';
import { MobileNav } from './MobileNav.tsx';
import { type NavItem, Rail } from './Rail.tsx';
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
  readonly children: ReactNode;
}

/**
 * The frame of every company page: the left icon rail, the top bar, the page, and the right rail with the
 * attention feed and the quick-create dock. From 80rem the right rail opens beside the page or collapses to a strip
 * (`useRightRail`); below that the bell opens it as a drawer. On phones the rail becomes a bottom bar.
 */
export function AppShell({ nav, badge, firstName, user, banner, children, now, ...rail }: AppShellProps) {
  const [drawer, setDrawer] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const attentionCount = rail.attention.length;
  const wide = useWideScreen();
  const right = useRightRail(attentionCount);
  // The collapsed rail's "+" asks for the composer's focus; any other toggle withdraws the request.
  const [composing, setComposing] = useState(false);
  const setRailOpen = (open: boolean) => {
    setComposing(false);
    right.setOpen(open);
  };
  const onBell = () => {
    if (!wide) {
      setDrawer(true);
      return;
    }
    setRailOpen(true);
    aside.current?.focus();
  };
  const onCompose = () => {
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
            attentionCount={attentionCount}
            attentionPulse={attentionCount > 0 && !wide}
            onBell={onBell}
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
          onCompose={onCompose}
          composing={composing}
          {...rail}
          {...(now !== undefined ? { now } : {})}
        />
      </div>
      <MobileNav items={nav} />
      <Drawer open={drawer} onClose={closeDrawer} title="Attention required" className="h-[calc(100vh-1rem)]">
        <RightRailContent {...rail} {...(now !== undefined ? { now } : {})} />
      </Drawer>
    </div>
  );
}
