import { Bell, CheckCheck } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { type Notification, useNotificationSettings, useNotifications } from '../../api/notifications.ts';
import { cx } from '../../components/cx.ts';
import { useDismiss } from '../../components/forms/Menu.tsx';
import { Switch } from '../../components/forms/Switch.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { NotificationList } from './NotificationList.tsx';

/** What the email switch says about this server's email (MWC_EMAIL). */
const SERVER_EMAIL = {
  outbox: 'This development server writes emails to its outbox instead of sending them.',
  smtp: null,
  off: 'Email is off on this server, so none go out for now.',
} as const;

/** The email switch: on by default, saved at once; with a note when this server sends none. */
function EmailSetting({ companyId }: { readonly companyId: string }) {
  const { settings, save } = useNotificationSettings(companyId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!settings) return null;
  const note = SERVER_EMAIL[settings.serverEmail];
  const change = (email: boolean) => {
    setSaving(true);
    setFailed(false);
    save(email)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <div className="border-t border-line px-2.5 pt-3 pb-1.5">
      <Switch checked={settings.email} onChange={change} disabled={saving} label="Email me these" />
      <p className="mt-1.5 text-xs text-dim">
        {failed
          ? 'That did not save. Try again.'
          : (note ?? 'A minute of changes goes out as one short email.')}
      </p>
    </div>
  );
}

/**
 * The top bar's bell (S2.9): the unread count on it, and a panel of the person's notifications in this company,
 * refreshed every minute. Opening one marks it read and goes to its page; "Mark all read" clears the count; the
 * switch at the bottom turns their emails here on or off.
 */
export function NotificationsBell({
  companyId,
  slug,
}: {
  readonly companyId: string;
  readonly slug: string;
}) {
  const live = useNotifications(companyId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  const unread = live.data?.unreadCount ?? 0;
  const notices = [...(live.data?.notifications ?? []), ...live.older];
  const onOpen = (notice: Notification) => {
    if (notice.readAt === null) void live.markRead([notice.id]).catch(() => undefined);
    if (notice.path !== null) close();
  };
  return (
    <div ref={root} className="relative inline-flex">
      <IconButton
        ref={button}
        label={unread > 0 ? `Notifications: ${unread} unread` : 'Notifications'}
        icon={Bell}
        tone="solid"
        size="lg"
        badge={unread}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        className="rounded-full"
      />
      <section
        id={id}
        hidden={!open}
        aria-label="Notifications"
        className={cx(
          'absolute top-full right-0 z-40 mt-2 flex max-h-[min(36rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl bg-surface p-1.5 shadow-float ring-1 ring-line',
        )}
      >
        <header className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-2">
          <h2 className="text-sm font-bold text-ink">Notifications</h2>
          <Button
            size="sm"
            tone="quiet"
            icon={CheckCheck}
            disabled={unread === 0}
            onClick={() => void live.markRead('all').catch(() => undefined)}
          >
            Mark all read
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {live.error !== undefined && live.data === undefined ? (
            <p className="px-3 py-6 text-center text-sm text-dim">
              Your notifications did not load. Try again soon.
            </p>
          ) : (
            <NotificationList notices={notices} slug={slug} onOpen={onOpen} />
          )}
          {live.hasMore && (
            <div className="flex justify-center py-2">
              <Button size="sm" tone="quiet" onClick={() => void live.more().catch(() => undefined)}>
                Show older
              </Button>
            </div>
          )}
        </div>
        {open && <EmailSetting companyId={companyId} />}
      </section>
    </div>
  );
}
