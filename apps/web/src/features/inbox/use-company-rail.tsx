import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { useCallback, useMemo } from 'react';
import { chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import { flowCalls } from '../../api/flows.ts';
import { type InboxItem, useInbox } from '../../api/inbox.ts';
import { type Notification, useNotifications } from '../../api/notifications.ts';
import type { QuestionAnswer } from '../../api/types.ts';
import type { AgentRef } from '../../components/feed/kinds.ts';
import type { RightRailProps } from '../../components/layout/RightRail.tsx';
import { rememberSent } from '../chats/thread/question/use-question-draft.ts';
import { EmailSetting } from '../notifications/EmailSetting.tsx';
import { MarkAllRead, NotificationsView } from '../notifications/NotificationsView.tsx';
import type { InboxMove } from './InboxCard.tsx';
import { InboxView } from './InboxView.tsx';
import { LiveQuickTask } from './LiveQuickTask.tsx';

/** Who is looking, in which company: what the rail needs of the page's membership. */
export interface RailViewer {
  readonly companyId: string;
  readonly slug: string;
  readonly companyName: string;
  readonly role: MembershipRole;
  readonly userId: string;
  /** The company's agents' icons by principal, for the Leads' chips. */
  readonly faces: ReadonlyMap<string, AgentRef>;
}

/**
 * The right rail of a company's pages (S6b), live: the inbox across the person's companies (`useInbox`, every 30 s and
 * after a move made from it, a Sign-off's moves sent to the task's own company, an agent's question answered in place
 * through its chat's answers route, S6c), this company's notifications
 * (`useNotifications`, with Mark all read, Show older and the email switch) and, for members and up, the quick-create
 * dock. Answers the props `AppShell` takes for its rail.
 */
export function useCompanyRail(viewer: RailViewer): RightRailProps {
  const api = useApi();
  const { companyId, slug } = viewer;
  const inbox = useInbox();
  const live = useNotifications(companyId);
  const reloadInbox = inbox.reload;
  const act = useCallback(
    async (item: InboxItem, move: InboxMove) => {
      if (!item.task) return;
      await flowCalls(api, item.company.id).act(item.task.key, {
        ...move,
        fromStepId: item.task.step?.id ?? null,
      });
      reloadInbox();
    },
    [api, reloadInbox],
  );
  const answer = useCallback(
    async (item: InboxItem, answers: QuestionAnswer[]) => {
      if (!item.question) return;
      const { chatId, questionId } = item.question;
      const turn = await chatCalls(api, item.company.id).answer(chatId, { questionId, answers });
      rememberSent(questionId, turn.id, answers);
      reloadInbox();
    },
    [api, reloadInbox],
  );
  const unread = live.data?.unreadCount ?? 0;
  const notices = useMemo(
    () => [...(live.data?.notifications ?? []), ...live.older],
    [live.data, live.older],
  );
  const onOpen = (notice: Notification) => {
    if (notice.readAt === null) void live.markRead([notice.id]).catch(() => undefined);
  };
  return {
    attention: (
      <InboxView
        items={inbox.data?.items}
        loading={inbox.loading}
        failed={inbox.error !== undefined}
        companyId={companyId}
        onAct={act}
        onAnswer={answer}
      />
    ),
    attentionCount: inbox.data?.count ?? 0,
    notifications: (
      <NotificationsView
        notices={notices}
        slug={slug}
        hasMore={live.hasMore}
        failed={live.error !== undefined && live.data === undefined}
        onOpen={onOpen}
        onMore={() => void live.more().catch(() => undefined)}
        email={<EmailSetting companyId={companyId} />}
      />
    ),
    unread,
    notificationsAction: (
      <MarkAllRead unread={unread} onMark={() => void live.markRead('all').catch(() => undefined)} />
    ),
    notificationsScope: `In ${viewer.companyName}`,
    dock: roleAtLeast(viewer.role, 'member') ? (
      <LiveQuickTask
        companyId={companyId}
        slug={slug}
        role={viewer.role}
        userId={viewer.userId}
        faces={viewer.faces}
        onMade={reloadInbox}
      />
    ) : undefined,
  };
}
