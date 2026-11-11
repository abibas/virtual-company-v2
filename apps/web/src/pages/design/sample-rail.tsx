import { useState } from 'react';
import type { InboxItem } from '../../api/inbox.ts';
import type { Notification } from '../../api/notifications.ts';
import type { RightRailProps } from '../../components/layout/RightRail.tsx';
import type { InboxMove } from '../../features/inbox/InboxCard.tsx';
import { InboxView } from '../../features/inbox/InboxView.tsx';
import { QuickTask } from '../../features/inbox/QuickTask.tsx';
import { EmailSwitch } from '../../features/notifications/EmailSetting.tsx';
import { MarkAllRead, NotificationsView } from '../../features/notifications/NotificationsView.tsx';
import { SAMPLE_INBOX, SAMPLE_NOTICES, SAMPLE_TEAMS } from './inbox-sample.ts';
import { SAMPLE_COMPANY } from './records.ts';

/**
 * The right rail on sample data, for the gallery's mock pages: the inbox (Approve and Send back take the card away, as
 * the real move would), the notifications (opening one or Mark all read marks them read) and the dock (which makes a
 * sample key). `empty` starts with nothing in either view.
 */
export function useSampleRail(empty: boolean): RightRailProps {
  const [items, setItems] = useState<readonly InboxItem[]>(empty ? [] : SAMPLE_INBOX);
  const [notices, setNotices] = useState<readonly Notification[]>(empty ? [] : SAMPLE_NOTICES);
  const [made, setMade] = useState(30);
  const [email, setEmail] = useState(true);
  const unread = notices.filter((n) => n.readAt === null).length;
  const read = (ids: readonly string[] | 'all') =>
    setNotices((all) =>
      all.map((n) =>
        ids === 'all' || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
      ),
    );
  const act = async (item: InboxItem, _move: InboxMove) =>
    setItems((all) => all.filter((i) => i.id !== item.id));
  return {
    attention: (
      <InboxView items={items} loading={false} failed={false} companyId={SAMPLE_COMPANY.id} onAct={act} />
    ),
    attentionCount: items.length,
    notifications: (
      <NotificationsView
        notices={notices}
        slug="design"
        hasMore={false}
        failed={false}
        onOpen={(n) => read([n.id])}
        onMore={() => undefined}
        email={
          <EmailSwitch
            checked={email}
            onChange={setEmail}
            note="A minute of changes goes out as one short email."
          />
        }
      />
    ),
    unread,
    notificationsAction: <MarkAllRead unread={unread} onMark={() => read('all')} />,
    notificationsScope: `In ${SAMPLE_COMPANY.name}`,
    dock: (
      <QuickTask
        teams={SAMPLE_TEAMS}
        companyId={SAMPLE_COMPANY.id}
        onCreate={async (team) => {
          setMade((n) => n + 1);
          return { key: `T-${made}`, where: team.leads ? 'at Develop' : 'queued' };
        }}
        taskHref={() => '/design/flows'}
        flowsHref="/design/flows"
      />
    ),
  };
}
