import type { InboxItem } from '../../api/inbox.ts';
import type { Notification } from '../../api/notifications.ts';
import type { QuickTeam } from '../../features/inbox/QuickTask.tsx';
import { SAMPLE_COMPANY } from './records.ts';

/**
 * The gallery's inbox (S6b): one item of every kind, the most urgent first as the server orders them, one of them in
 * another company; the notifications of the sample company; and the teams of the quick-create dock. Ages are counted from
 * the moment the gallery opens, so they always read "5 min ago" and so on.
 */

const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

const company = { id: SAMPLE_COMPANY.id, slug: SAMPLE_COMPANY.slug, name: SAMPLE_COMPANY.name };
const globex = { id: 'globex', slug: 'globex', name: 'Globex' };
const lead = {
  principalId: 'p-lead',
  kind: 'agent' as const,
  name: 'DEVBOX Coordinator',
  slug: 'devbox-coordinator',
};
const agent = (name: string, slug: string) => ({
  principalId: `p-${slug}`,
  kind: 'agent' as const,
  name,
  slug,
});
const person = (name: string) => ({ principalId: `p-${name}`, kind: 'person' as const, name, slug: null });
const flow = { id: 'f-devbox', name: 'DEVBOX delivery', lead };

type Kind = InboxItem['kind'];

function taskItem(
  kind: Kind,
  task: {
    key: string;
    title: string;
    step: string;
    stepKind: 'work' | 'check' | 'signoff';
    priority?: 'high';
  },
  more: Partial<InboxItem>,
): InboxItem {
  return {
    id: `task:${task.key}`,
    kind,
    company,
    title: task.title,
    subtitle: `${flow.name} · ${task.step}`,
    reason: null,
    from: null,
    link: `tasks/${task.key}`,
    actions: [],
    task: {
      id: task.key,
      key: task.key,
      title: task.title,
      priority: task.priority ?? 'normal',
      flow,
      step: { id: `s-${task.step}`, name: task.step, kind: task.stepKind },
      round: kind === 'escalated' ? null : 1,
    },
    question: null,
    at: ago(5),
    ...more,
  };
}

export const SAMPLE_INBOX: readonly InboxItem[] = [
  taskItem(
    'escalated',
    {
      key: 'T-9',
      title: 'Rate limiter drops webhooks under load',
      step: 'Code review',
      stepKind: 'check',
      priority: 'high',
    },
    {
      reason:
        'Code review sent it back 3 times already, its limit; this time: the retry test still fails on CI',
      from: agent('Code Reviewer', 'code-reviewer'),
      actions: ['route', 'retry', 'cancel'],
      at: ago(48),
    },
  ),
  taskItem(
    'signoff',
    { key: 'T-12', title: 'Fix the login redirect loop', step: 'Approve', stepKind: 'signoff' },
    { from: person('Mia Chen'), actions: ['approve', 'send_back', 'route', 'cancel'], at: ago(6) },
  ),
  {
    id: 'question:q1',
    kind: 'question',
    company,
    title: 'Which database should the export service use?',
    subtitle: 'SLOP BOX · T-15 · Develop · Nightly export',
    reason: null,
    from: agent('SLOP BOX', 'slop-box'),
    link: 'chats/a-slop?chat=c1',
    actions: ['answer'],
    task: null,
    question: {
      chatId: 'c1',
      agentId: 'a-slop',
      questionId: 'q1',
      count: 2,
      chatTitle: 'T-15 · Develop · Nightly export',
      taskKey: 'T-15',
    },
    at: ago(12),
  },
  taskItem(
    'step',
    { key: 'T-21', title: 'Check the onboarding copy', step: 'Copy check', stepKind: 'check' },
    { from: agent('Developer', 'developer'), actions: ['start', 'pass', 'send_back'], at: ago(31) },
  ),
  taskItem(
    'blocked',
    { key: 'T-16', title: 'Nightly export of the audit log', step: 'Develop', stepKind: 'work' },
    {
      reason: 'The agent has no placement: choose where it runs first',
      from: agent('Developer', 'developer'),
      actions: ['start', 'hand_on', 'route', 'cancel'],
      at: ago(75),
    },
  ),
  taskItem(
    'turn_ended',
    { key: 'T-4', title: 'Upgrade the runner on the devbox', step: 'QA', stepKind: 'check' },
    {
      company: globex,
      from: agent('QA bot', 'qa-bot'),
      actions: ['start', 'pass', 'send_back'],
      at: ago(190),
    },
  ),
];

const notice = (
  id: string,
  text: string,
  minutes: number,
  read: boolean,
  path: string | null,
): Notification => ({
  id,
  kind: 'task_signoff',
  text,
  actor: { principalId: 'p-mia', name: 'Mia Chen' },
  path,
  createdAt: ago(minutes),
  readAt: read ? ago(minutes - 1) : null,
});

export const SAMPLE_NOTICES: readonly Notification[] = [
  notice('n1', 'T-12 “Fix the login redirect loop” needs your sign-off at Approve', 6, false, 'tasks/T-12'),
  notice(
    'n2',
    'T-9 “Rate limiter drops webhooks under load” was escalated to DEVBOX Coordinator',
    48,
    false,
    'tasks/T-9',
  ),
  notice('n3', 'Mia Chen now reports to you', 60 * 26, true, 'structure'),
];

export const SAMPLE_TEAMS: readonly QuickTeam[] = [
  {
    flowId: 'f-devbox',
    flowName: 'DEVBOX delivery',
    lead: { principalId: 'p-lead', name: 'DEVBOX Coordinator', kind: 'agent' },
    face: { id: 'a-lead', name: 'DEVBOX Coordinator', face: 4 },
    leads: true,
  },
  {
    flowId: 'f-growth',
    flowName: 'Growth',
    lead: { principalId: 'p-mia', name: 'Mia Chen', kind: 'person' },
    leads: false,
  },
];
