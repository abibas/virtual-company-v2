import { CheckCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Notification } from '../../api/notifications.ts';
import { Button } from '../../components/ui/Button.tsx';
import { NotificationList } from './NotificationList.tsx';

/** "Mark all read", beside the Notifications tab's scope; idle while nothing is unread. */
export function MarkAllRead({ unread, onMark }: { readonly unread: number; readonly onMark: () => void }) {
  return (
    <Button size="sm" tone="quiet" icon={CheckCheck} disabled={unread === 0} onClick={onMark}>
      Mark all read
    </Button>
  );
}

/**
 * The right rail's Notifications view (S2.9, moved from the top bar's bell in S6b): the person's notices in this company,
 * newest first, Show older below them, and the email switch (`email`) at the foot. Opening one marks it read and goes
 * to its page (`onOpen`). The data comes as props, so the design gallery draws it on samples.
 */
export function NotificationsView({
  notices,
  slug,
  hasMore,
  failed,
  onOpen,
  onMore,
  email,
}: {
  readonly notices: readonly Notification[];
  readonly slug: string;
  readonly hasMore: boolean;
  /** The first read failed: one line instead of the list. */
  readonly failed: boolean;
  readonly onOpen: (notice: Notification) => void;
  readonly onMore: () => void;
  readonly email?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {failed ? (
          <p className="px-3 py-6 text-center text-sm text-dim">
            Your notifications did not load. Try again soon.
          </p>
        ) : (
          <NotificationList notices={notices} slug={slug} onOpen={onOpen} />
        )}
        {hasMore && (
          <div className="flex justify-center py-2">
            <Button size="sm" tone="quiet" onClick={onMore}>
              Show older
            </Button>
          </div>
        )}
      </div>
      {email}
    </div>
  );
}
