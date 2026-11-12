import { Bell, Inbox, type LucideIcon, MessagesSquare } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { cx } from '../cx.ts';

/** The right rail's views: what needs the person, their notifications, and the chats with their direct reports. */
export type RailView = 'attention' | 'notifications' | 'chats';

type Tab = { readonly view: RailView; readonly label: string; readonly icon: LucideIcon };

const TABS: readonly Tab[] = [
  { view: 'attention', label: 'Attention', icon: Inbox },
  { view: 'notifications', label: 'Notifications', icon: Bell },
  { view: 'chats', label: 'Chats', icon: MessagesSquare },
];

/** A tab's count: red for what needs the person, blue for unread notices; nothing at 0. */
function TabCount({ count, tone }: { readonly count: number; readonly tone: 'attention' | 'unread' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-2xs font-bold tabular',
        tone === 'attention' ? 'bg-failed text-white' : 'bg-blue text-on-blue',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * The tabs (the ARIA tabs pattern: arrow keys move between them), the open view's scope and its action under them,
 * and the open view scrolling below; `action` sits at the header's right (the rail's collapse button). The Chats tab
 * shows only with a Chats view, which fills the panel and scrolls inside itself (its thread), with no scope line.
 */
export function RailViews({
  view: wanted,
  onView,
  attention,
  attentionCount,
  notifications,
  unread,
  notificationsAction,
  notificationsScope,
  chats,
  chatsCount = 0,
  action,
}: {
  readonly view: RailView;
  readonly onView: (view: RailView) => void;
  readonly attention: ReactNode;
  readonly attentionCount: number;
  readonly notifications: ReactNode;
  readonly unread: number;
  readonly notificationsAction?: ReactNode;
  readonly notificationsScope?: string | undefined;
  readonly chats?: ReactNode;
  readonly chatsCount?: number | undefined;
  readonly action?: ReactNode;
}) {
  const id = useId();
  const tabs = chats ? TABS : TABS.filter((tab) => tab.view !== 'chats');
  const view = wanted === 'chats' && !chats ? 'attention' : wanted;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    onView((tabs[next] as Tab).view);
    buttons.current[next]?.focus();
  };
  const counts: Readonly<Record<RailView, number>> = {
    attention: attentionCount,
    notifications: unread,
    chats: chatsCount,
  };
  const scope = view === 'attention' ? 'Across all companies' : notificationsScope;
  const shown = { attention, notifications, chats }[view];
  return (
    <section aria-label="Inbox" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Inbox"
          className="inline-flex items-center gap-0.5 rounded-full bg-surface-3 p-1"
        >
          {tabs.map((tab, index) => {
            const on = tab.view === view;
            const Icon = tab.icon;
            // Three tabs do not fit the rail with their words: the others show their icon and count only.
            const short = chats !== undefined && !on;
            return (
              <button
                key={tab.view}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-${tab.view}`}
                aria-selected={on}
                aria-controls={`${id}-panel`}
                tabIndex={on ? 0 : -1}
                title={short ? tab.label : undefined}
                onClick={() => onView(tab.view)}
                onKeyDown={(event) => onKey(event, index)}
                className={cx(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
                  short ? 'px-2' : 'px-2.5',
                  on ? 'bg-surface text-ink shadow-card' : 'text-dim hover:text-ink',
                )}
              >
                <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
                <span className={cx(short && 'sr-only')}>{tab.label}</span>
                <TabCount count={counts[tab.view]} tone={tab.view === 'attention' ? 'attention' : 'unread'} />
              </button>
            );
          })}
        </div>
        {action}
      </header>
      {view !== 'chats' && (
        <div className="mt-1.5 flex min-h-7 items-center justify-between gap-2 px-1">
          <p className="truncate text-xs text-dim">{scope}</p>
          {view === 'notifications' && notificationsAction}
        </div>
      )}
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${view}`}
        className={cx(
          'min-h-0 flex-1',
          view === 'chats' ? 'mt-3 flex flex-col' : 'scroll-quiet mt-1 overflow-y-auto',
        )}
      >
        {shown}
      </div>
    </section>
  );
}
