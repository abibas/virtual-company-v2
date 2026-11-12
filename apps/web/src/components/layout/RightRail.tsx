import { PanelRightClose } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { cx } from '../cx.ts';
import { Card } from '../ui/Card.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { RailStrip } from './RailStrip.tsx';
import { type RailView, RailViews } from './RailViews.tsx';

export type { RailView };

/**
 * What the right rail holds: the inbox (what needs the person), the notifications and, when the person has direct
 * reports who are agents, the chats with them, each a view of its own.
 */
export interface RightRailProps {
  /** The Attention view: what needs the person, across their companies. */
  readonly attention: ReactNode;
  readonly attentionCount: number;
  /** The Notifications view: the notices of this company. */
  readonly notifications: ReactNode;
  readonly unread: number;
  /** At the right of the Notifications view's line under the tabs (Mark all read). */
  readonly notificationsAction?: ReactNode;
  /** The Notifications view's scope, under the tabs ("In Acme"). */
  readonly notificationsScope?: string | undefined;
  /** Pinned at the foot of the Attention view (quick create); none also hides the strip's "+". */
  readonly dock?: ReactNode;
  /** The Chats view: a chat with one of the person's direct reports; none hides its tab. */
  readonly chats?: ReactNode;
  /** The Chats tab's count (blue): the chats that wait for the person. */
  readonly chatsCount?: number | undefined;
  /** The collapsed strip's own group under the bell (the direct reports' faces), given the way to open a view. */
  readonly strip?: ((open: (view: RailView) => void) => ReactNode) | undefined;
}

/**
 * The rail's content: the two tabs with their counts and the collapse button, the open view scrolling, and the dock under
 * the Attention view. `focusDock` focuses the dock's first field as it shows (the strip's "+").
 */
export function RightRailContent({
  view,
  onView,
  onCollapse,
  focusDock,
  className,
  ...content
}: RightRailProps & {
  readonly view: RailView;
  readonly onView: (view: RailView) => void;
  readonly onCollapse?: (() => void) | undefined;
  readonly focusDock?: boolean | undefined;
  readonly className?: string;
}) {
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusDock) dock.current?.querySelector<HTMLElement>('input:not(:disabled), textarea')?.focus();
  }, [focusDock]);
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', className)}>
      <RailViews
        view={view}
        onView={onView}
        {...content}
        action={
          onCollapse && (
            <IconButton
              label="Collapse the right rail"
              icon={PanelRightClose}
              size="sm"
              tooltip="left"
              aria-expanded
              data-rail-toggle
              onClick={onCollapse}
            />
          )
        }
      />
      {view === 'attention' && content.dock && (
        <div ref={dock} className="mt-3 shrink-0">
          {content.dock}
        </div>
      )}
    </div>
  );
}

export interface RightRailFrameProps extends RightRailProps {
  readonly asideRef: RefObject<HTMLElement | null>;
  /** The card is open; else the rail is the slim strip at the right edge (`useRightRail`). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: RailView;
  readonly onView: (view: RailView) => void;
  /** Opens the rail on its dock, with `composing` set until the next toggle: the dock's field takes the focus. */
  readonly onCompose: () => void;
  readonly composing?: boolean | undefined;
}

/**
 * The right rail on wide screens: open, a card the height of the window with the open view scrolling inside it;
 * collapsed, a slim strip at the right edge whose icons open each view. The width moves between the two in a short
 * transition (none with reduced motion) and the page takes the room; the card keeps its width and slides out from the
 * edge. After a toggle the focus moves to the button that toggles back.
 */
export function RightRail({
  asideRef,
  open,
  onOpenChange,
  view,
  onView,
  onCompose,
  composing,
  ...content
}: RightRailFrameProps) {
  const toggled = useRef(false);
  const toggle = (next: boolean) => {
    toggled.current = true;
    onOpenChange(next);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the rail opens or collapses.
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    asideRef.current?.querySelector<HTMLElement>('[data-rail-toggle]')?.focus();
  }, [open]);
  const openOn = (next: RailView) => {
    onView(next);
    toggle(true);
  };
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Inbox"
      className={cx(
        'sticky top-0 hidden h-screen shrink-0 py-3 pr-3 outline-none transition-[width] duration-200 ease-out motion-reduce:transition-none xl:block',
        open ? 'w-aside' : 'w-16',
      )}
    >
      {open ? (
        // Clips the card while the rail widens; 1rem of room on the left keeps its shadow.
        <div className="pointer-events-none absolute inset-y-0 right-0 -left-4 flex justify-end overflow-hidden py-3 pr-3 pl-4">
          <Card
            padding="sm"
            className="pointer-events-auto flex h-full w-[calc(var(--spacing-aside)-0.75rem)] shrink-0 flex-col"
          >
            <RightRailContent
              {...content}
              view={view}
              onView={onView}
              onCollapse={() => toggle(false)}
              focusDock={composing}
            />
          </Card>
        </div>
      ) : (
        <RailStrip
          attentionCount={content.attentionCount}
          unread={content.unread}
          onOpen={openOn}
          onExpand={() => toggle(true)}
          {...(content.dock ? { onCompose } : {})}
        >
          {content.strip?.(openOn)}
        </RailStrip>
      )}
    </aside>
  );
}
