import { Bell, Inbox, PanelRightOpen, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../ui/IconButton.tsx';
import type { RailView } from './RailViews.tsx';

/**
 * The right rail collapsed: a slim strip at the right edge with the way back (expand), what needs the person (its count
 * in a dot that pulses while something waits), the notifications (the unread count), each opening its view, the page's
 * own group under them (the direct reports' faces), and at the foot a "+" that opens the rail on its dock (quick create)
 * when it has one.
 */
export function RailStrip({
  attentionCount,
  unread,
  onOpen,
  onExpand,
  onCompose,
  children,
}: {
  readonly attentionCount: number;
  readonly unread: number;
  readonly onOpen: (view: RailView) => void;
  readonly onExpand: () => void;
  /** Opens the rail with the dock's field focused; none: no "+". */
  readonly onCompose?: () => void;
  /** Under the bell: the direct reports' faces. */
  readonly children?: ReactNode;
}) {
  return (
    // A card without its clipping, so the tooltips and the pulse can reach past the strip.
    <div className="ml-auto flex h-full w-13 flex-col items-center gap-2 rounded-2xl bg-surface py-3 shadow-card">
      <IconButton
        label="Expand the right rail"
        icon={PanelRightOpen}
        tooltip="left"
        aria-expanded={false}
        data-rail-toggle
        onClick={onExpand}
      />
      <span aria-hidden="true" className="h-px w-6 bg-line" />
      <IconButton
        label={attentionCount > 0 ? `Attention required: ${attentionCount}` : 'Attention required'}
        icon={Inbox}
        tooltip="left"
        badge={attentionCount}
        pulse
        onClick={() => onOpen('attention')}
      />
      <IconButton
        label={unread > 0 ? `Notifications: ${unread} unread` : 'Notifications'}
        icon={Bell}
        tooltip="left"
        badge={unread}
        badgeTone="info"
        onClick={() => onOpen('notifications')}
      />
      {children}
      {onCompose && (
        <div className="mt-auto">
          <IconButton
            label="Quick create task"
            icon={Plus}
            tone="soft"
            round
            tooltip="left"
            onClick={onCompose}
          />
        </div>
      )}
    </div>
  );
}
