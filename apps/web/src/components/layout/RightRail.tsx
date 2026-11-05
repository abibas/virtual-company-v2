import type { RefObject } from 'react';
import { cx } from '../cx.ts';
import { AttentionFeed } from '../feed/AttentionFeed.tsx';
import type { AgentRef, AttentionItem } from '../feed/kinds.ts';
import { QuickCreate } from '../feed/QuickCreate.tsx';
import { Card } from '../ui/Card.tsx';

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

/** What the right rail holds: the attention feed above, the quick-create dock pinned below. */
export function RightRailContent({
  attention,
  attentionLoading = false,
  agents,
  onQuickCreate,
  quickCreateNote,
  seeAllHref,
  now,
  className,
}: RightRailProps & { readonly className?: string }) {
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', className)}>
      <AttentionFeed
        items={attention}
        loading={attentionLoading}
        className="min-h-0 flex-1"
        {...(seeAllHref !== undefined ? { seeAllHref } : {})}
        {...(now !== undefined ? { now } : {})}
      />
      <QuickCreate
        agents={agents}
        {...(onQuickCreate !== undefined ? { onCreate: onQuickCreate } : {})}
        disabledNote={quickCreateNote}
        className="mt-3 shrink-0"
      />
    </div>
  );
}

/** The right rail on wide screens: a card the height of the window, the feed scrolling inside it. */
export function RightRail(props: RightRailProps & { readonly asideRef?: RefObject<HTMLElement | null> }) {
  const { asideRef, ...content } = props;
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Attention required"
      className="sticky top-0 hidden h-screen w-aside shrink-0 py-3 pr-3 outline-none xl:block"
    >
      <Card padding="sm" className="flex h-full flex-col">
        <RightRailContent {...content} />
      </Card>
    </aside>
  );
}
