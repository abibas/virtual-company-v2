import type { MembershipRole, NotificationKind } from '@mwc/shared/enums';
import type { NoticePayload } from '../rules.ts';

/**
 * What a notice says, from its recipient's side, and where it points in the app; and the email of a person's notices
 * (S2.9). Names are looked up when it is shown (`Names`), so a renamed person reads with their new name.
 */

/** The names of the principals a notice mentions, and the address of an agent's page. */
export interface Names {
  /** A person's name (their email while they have none) or an agent's; "someone" for one not found. */
  name(principalId: string | null | undefined): string;
  /** An agent's slug, for its page; undefined for a person. */
  agentSlug(principalId: string): string | undefined;
  /** A task's key and title (S5.3a); undefined for one not found. */
  task(taskId: string | undefined): { readonly key: string; readonly title: string } | undefined;
}

const ROLE_WORDS: Readonly<Record<MembershipRole, string>> = {
  owner: 'an owner',
  admin: 'an admin',
  member: 'a member',
  viewer: 'a viewer',
};

const roleWords = (role: MembershipRole | undefined) => (role ? ROLE_WORDS[role] : 'a member');

type Words = (p: NoticePayload, names: Names, company: string) => string;

/** A task as a notice names it: `T-12 “Fix login”`, or "A task" for one not found. */
function taskWords(p: NoticePayload, names: Names): string {
  const task = names.task(p.task);
  return task ? `${task.key} “${task.title}”` : 'A task';
}

const WORDS: Readonly<Record<NotificationKind, Words>> = {
  manager_changed: (p, n) =>
    p.to ? `You now report to ${n.name(p.to)}` : 'You now stand at the top of the org chart',
  report_added: (p, n) => `${n.name(p.about)} now reports to you`,
  report_removed: (p, n) =>
    `${n.name(p.about)} no longer reports to you${p.to ? `; they report to ${n.name(p.to)} now` : ''}`,
  role_changed: (p, _, company) =>
    `You are now ${roleWords(p.role)} in ${company}${p.previousRole ? ` (you were ${roleWords(p.previousRole)})` : ''}`,
  membership_suspended: (_, __, company) => `Your access to ${company} is suspended`,
  membership_reactivated: (_, __, company) => `Your access to ${company} is back`,
  membership_removed: (_, __, company) => `You were removed from ${company}`,
  agent_paused: (p, n) => `${n.name(p.about)}, an agent reporting to you, was paused`,
  agent_resumed: (p, n) => `${n.name(p.about)}, an agent reporting to you, was resumed`,
  agent_archived: (p, n) => `${n.name(p.about)}, an agent reporting to you, was archived`,
  invitation_accepted: (p, n, company) =>
    `${n.name(p.about)} accepted your invitation and joined ${company} as ${roleWords(p.role)}`,
  task_at_step: (p, n) => `${taskWords(p, n)} is at your step${p.step ? ` ${p.step}` : ''}`,
  task_signoff: (p, n) => `${taskWords(p, n)} needs your sign-off${p.step ? ` at ${p.step}` : ''}`,
  task_escalated: (p, n) =>
    `${taskWords(p, n)} was escalated to ${n.name(p.about)}${p.step ? ` from ${p.step}` : ''}`,
  task_done: (p, n) => `${taskWords(p, n)} is done`,
  task_turn_ended: (p, n) =>
    `${n.name(p.about)} ended its turn on ${taskWords(p, n)}${p.step ? ` at ${p.step}` : ''}; nobody has moved it on yet`,
  task_blocked: (p, n) =>
    `${taskWords(p, n)} is blocked${p.step ? ` at ${p.step}` : ''}: ${n.name(p.about)}'s turn could not start or failed`,
  agent_question: (p, n) => `${n.name(p.about)} asks: “${p.detail ?? 'a question'}”`,
  lead_not_woken: (p, n) => leadNotWoken(n.name(p.about), p),
};

/** A Lead agent that was not woken, and why (S6c): its team's events wait for the person told. */
function leadNotWoken(lead: string, p: NoticePayload): string {
  if (p.reason === 'unreachable')
    return `${lead} could not be woken for its team's tasks: ${p.detail ?? 'it cannot run now'}`;
  const when = p.reason === 'day_cap' ? 'today' : 'this hour';
  return `${lead} was not woken for its team's tasks: it had all its wake-ups for ${when}`;
}

/** The notice's sentence, from its recipient's side (no final period). */
export function noticeText(
  kind: NotificationKind,
  payload: NoticePayload,
  names: Names,
  company: string,
): string {
  return WORDS[kind](payload, names, company);
}

/**
 * Where the notice points, as a path inside the company (`/<slug>/<path>`): a task's page (`tasks/T-12`), an agent's
 * page, the chat an agent asks in, a team's board (`flows/<lead>`), the people, or the org chart; null after a removal
 * or suspension, which leave the person without access.
 */
export function noticePath(kind: NotificationKind, payload: NoticePayload, names: Names): string | null {
  if (kind === 'membership_removed' || kind === 'membership_suspended') return null;
  if (kind === 'agent_question') {
    return payload.agent && payload.chat ? `chats/${payload.agent}?chat=${payload.chat}` : 'structure/agents';
  }
  if (kind === 'lead_not_woken') {
    const slug = names.agentSlug(payload.about);
    return slug === undefined ? 'flows' : `flows/${slug}`;
  }
  if (kind.startsWith('task_')) {
    const task = names.task(payload.task);
    return task === undefined ? 'tasks' : `tasks/${task.key}`;
  }
  if (kind.startsWith('agent_')) {
    const slug = names.agentSlug(payload.about);
    return slug === undefined ? 'structure/agents' : `agents/${slug}`;
  }
  if (kind === 'role_changed' || kind === 'invitation_accepted' || kind === 'membership_reactivated') {
    return 'structure/people';
  }
  return 'structure';
}

/** One notice as the email lists it. */
export interface EmailLine {
  readonly text: string;
  readonly actor: string | null;
  readonly path: string | null;
}

/** Lines an email lists before "and N more". */
export const EMAIL_LINES = 3;
/** A subject longer than this is cut, with an ellipsis. */
export const SUBJECT_LENGTH = 120;

const cut = (text: string) => (text.length > SUBJECT_LENGTH ? `${text.slice(0, SUBJECT_LENGTH - 1)}…` : text);
const byLine = (actor: string | null) => (actor ? ` (by ${actor})` : '');

/**
 * A person's notices as one short plain email: one notice is its own subject; several are counted in the subject and
 * listed (up to `EMAIL_LINES`). The link opens the app at the first notice's page (the company's org chart for several),
 * or the app's start when the person has no access any more.
 */
export function noticeEmail(
  lines: readonly EmailLine[],
  company: { readonly name: string; readonly slug: string },
  webOrigin: string,
): { readonly subject: string; readonly text: string } {
  const [first] = lines;
  const single = lines.length === 1 && first !== undefined;
  const path = single ? first.path : 'structure';
  const link = path === null ? `${webOrigin}/` : `${webOrigin}/${company.slug}/${path}`;
  const subject = single ? cut(first.text) : `${lines.length} changes for you in ${company.name}`;
  const listed = lines.slice(0, EMAIL_LINES).map((line) => `- ${line.text}${byLine(line.actor)}.`);
  const more = lines.length > EMAIL_LINES ? [`- and ${lines.length - EMAIL_LINES} more.`] : [];
  const body = single ? [`${first.text}${byLine(first.actor)}.`] : [...listed, ...more];
  const footer = `You get these emails while email notifications are on for you in ${company.name}; turn them off from the bell in the app.`;
  return { subject, text: [...body, '', `Open the app: ${link}`, '', footer, ''].join('\n') };
}
