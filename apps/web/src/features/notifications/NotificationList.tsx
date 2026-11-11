import type { Notification } from '../../api/notifications.ts';
import { companyPath } from '../../app/nav.ts';
import { Link } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { ago, formatDateTime } from '../../components/data/format.ts';

/** One notification: a dot while unread, its words, who did it and when; a link to its page when it has one. */
function Row({
  notice,
  slug,
  onOpen,
}: {
  readonly notice: Notification;
  readonly slug: string;
  readonly onOpen: (notice: Notification) => void;
}) {
  const unread = notice.readAt === null;
  const meta = [...(notice.actor ? [`by ${notice.actor.name}`] : []), ago(notice.createdAt)];
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cx('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-blue' : 'bg-transparent')}
      />
      <span className="min-w-0 flex-1">
        <span className={cx('block text-sm leading-snug', unread ? 'font-semibold text-ink' : 'text-ink-2')}>
          {notice.text}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="mt-0.5 block text-xs text-dim" title={formatDateTime(notice.createdAt)}>
          {meta.join(' · ')}
        </span>
      </span>
    </>
  );
  const className = cx(
    'flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
    unread && 'bg-blue-soft/40',
  );
  if (notice.path === null) {
    return (
      <button type="button" className={cx(className, 'cursor-pointer')} onClick={() => onOpen(notice)}>
        {body}
      </button>
    );
  }
  return (
    <Link to={companyPath(slug, notice.path)} className={className} onClick={() => onOpen(notice)}>
      {body}
    </Link>
  );
}

/** The notifications, newest first, or what to say when there are none. */
export function NotificationList({
  notices,
  slug,
  onOpen,
}: {
  readonly notices: readonly Notification[];
  readonly slug: string;
  readonly onOpen: (notice: Notification) => void;
}) {
  if (notices.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-dim">No notifications.</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {notices.map((notice) => (
        <li key={notice.id}>
          <Row notice={notice} slug={slug} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
