import { PanelRightClose } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import { cx } from '../cx.ts';
import { AttentionFeed } from '../feed/AttentionFeed.tsx';
import type { AgentRef, AttentionItem } from '../feed/kinds.ts';
import { QuickCreate } from '../feed/QuickCreate.tsx';
import { Card } from '../ui/Card.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { RailStrip } from './RailStrip.tsx';

export interface RightRailProps {
  readonly attention: readonly AttentionItem[];
  readonly attentionLoading?: boolean;
  readonly agents: readonly AgentRef[];
  readonly onQuickCreate?: ((agentId: string, text: string) => void) | undefined;
  /** Why the dock takes no task yet (without `onQuickCreate`): "Tasks arrive in S4". */
  readonly quickCreateNote?: string | undefined;
  readonly seeAllHref?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * What the right rail holds: the attention feed above, the quick-create dock pinned below. `onCollapse` puts a
 * collapse button in the feed's header; `focusComposer` focuses the dock's composer as it shows.
 */
export function RightRailContent({
  attention,
  attentionLoading = false,
  agents,
  onQuickCreate,
  quickCreateNote,
  seeAllHref,
  now,
  onCollapse,
  focusComposer,
  className,
}: RightRailProps & {
  readonly onCollapse?: (() => void) | undefined;
  readonly focusComposer?: boolean | undefined;
  readonly className?: string;
}) {
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', className)}>
      <AttentionFeed
        items={attention}
        loading={attentionLoading}
        className="min-h-0 flex-1"
        {...(seeAllHref !== undefined ? { seeAllHref } : {})}
        {...(now !== undefined ? { now } : {})}
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
      <QuickCreate
        agents={agents}
        {...(onQuickCreate !== undefined ? { onCreate: onQuickCreate } : {})}
        disabledNote={quickCreateNote}
        focusComposer={focusComposer}
        className="mt-3 shrink-0"
      />
    </div>
  );
}

export interface RightRailFrameProps extends RightRailProps {
  readonly asideRef: RefObject<HTMLElement | null>;
  /** The card is open; else the rail is the slim strip at the right edge (`useRightRail`). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Opens the rail on Quick create, with `composing` set until the next toggle: the composer takes the focus. */
  readonly onCompose: () => void;
  readonly composing?: boolean | undefined;
}

/**
 * The right rail on wide screens: open, a card the height of the window with the feed scrolling inside it;
 * collapsed, a slim strip at the right edge. The width moves between the two in a short transition (none with
 * reduced motion) and the page takes the room; the card keeps its width and slides out from the edge. After a toggle
 * the focus moves to the button that toggles back.
 */
export function RightRail({
  asideRef,
  open,
  onOpenChange,
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
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Attention required"
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
            <RightRailContent {...content} onCollapse={() => toggle(false)} focusComposer={composing} />
          </Card>
        </div>
      ) : (
        <RailStrip count={content.attention.length} onExpand={() => toggle(true)} onCompose={onCompose} />
      )}
    </aside>
  );
}
