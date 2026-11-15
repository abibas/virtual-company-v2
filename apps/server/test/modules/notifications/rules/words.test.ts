import type { NotificationKind } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_LINES,
  type Names,
  noticeEmail,
  noticePath,
  noticeText,
  SUBJECT_LENGTH,
} from '../../../../src/modules/notifications/rules/words.ts';
import type { NoticePayload } from '../../../../src/modules/notifications/rules.ts';

const NAMES: Readonly<Record<string, string>> = { m: 'Mia', a: 'Anna', b: 'Bob', g: 'SLOP BOX' };
const names: Names = {
  name: (id) => (id ? (NAMES[id] ?? 'Someone') : 'Someone'),
  agentSlug: (id) => (id === 'g' ? 'slop-box' : undefined),
  task: (id) => (id === 't' ? { key: 'T-12', title: 'Fix the login' } : undefined),
};
const say = (kind: NotificationKind, payload: NoticePayload) => noticeText(kind, payload, names, 'Acme');

describe('noticeText', () => {
  it('words every kind from its recipient’s side', () => {
    expect(say('manager_changed', { about: 'm', from: 'a', to: 'b' })).toBe('You now report to Bob');
    expect(say('manager_changed', { about: 'm', from: 'a', to: null })).toBe(
      'You now stand at the top of the org chart',
    );
    expect(say('report_added', { about: 'm', from: 'a', to: 'b' })).toBe('Mia now reports to you');
    expect(say('report_removed', { about: 'm', from: 'a', to: 'b' })).toBe(
      'Mia no longer reports to you; they report to Bob now',
    );
    expect(say('report_removed', { about: 'm', from: 'a', to: null })).toBe('Mia no longer reports to you');
    expect(say('role_changed', { about: 'm', role: 'admin', previousRole: 'member' })).toBe(
      'You are now an admin in Acme (you were a member)',
    );
    expect(say('role_changed', { about: 'm', role: 'owner' })).toBe('You are now an owner in Acme');
    expect(say('membership_suspended', { about: 'm' })).toBe('Your access to Acme is suspended');
    expect(say('membership_reactivated', { about: 'm' })).toBe('Your access to Acme is back');
    expect(say('membership_removed', { about: 'm' })).toBe('You were removed from Acme');
    expect(say('agent_paused', { about: 'g' })).toBe('SLOP BOX, an agent reporting to you, was paused');
    expect(say('agent_resumed', { about: 'g' })).toBe('SLOP BOX, an agent reporting to you, was resumed');
    expect(say('agent_archived', { about: 'g' })).toBe('SLOP BOX, an agent reporting to you, was archived');
    expect(say('invitation_accepted', { about: 'x', role: 'viewer' })).toBe(
      'Someone accepted your invitation and joined Acme as a viewer',
    );
    expect(say('invitation_accepted', { about: 'x' })).toBe(
      'Someone accepted your invitation and joined Acme as a member',
    );
  });
});

describe('noticeText for tasks (S5.3a)', () => {
  it('names the task by key and title, the step, and the Lead', () => {
    expect(say('task_at_step', { about: 'g', task: 't', step: 'QA' })).toBe(
      'T-12 “Fix the login” is at your step QA',
    );
    expect(say('task_at_step', { about: 'g', task: 't' })).toBe('T-12 “Fix the login” is at your step');
    expect(say('task_signoff', { about: 'g', task: 't', step: 'Approve' })).toBe(
      'T-12 “Fix the login” needs your sign-off at Approve',
    );
    expect(say('task_signoff', { about: 'g', task: 't' })).toBe('T-12 “Fix the login” needs your sign-off');
    expect(say('task_escalated', { about: 'g', task: 't', step: 'Code review' })).toBe(
      'T-12 “Fix the login” was escalated to SLOP BOX from Code review',
    );
    expect(say('task_escalated', { about: 'g', task: 't' })).toBe(
      'T-12 “Fix the login” was escalated to SLOP BOX',
    );
    expect(say('task_done', { about: 'g', task: 'gone' })).toBe('A task is done');
  });

  it('says a step’s run needs a person (S5.3b): its turn ended without a hand-off, or it is blocked', () => {
    expect(say('task_turn_ended', { about: 'g', task: 't', step: 'Develop' })).toBe(
      'SLOP BOX ended its turn on T-12 “Fix the login” at Develop; nobody has moved it on yet',
    );
    expect(say('task_turn_ended', { about: 'g', task: 't' })).toBe(
      'SLOP BOX ended its turn on T-12 “Fix the login”; nobody has moved it on yet',
    );
    expect(say('task_blocked', { about: 'g', task: 't', step: 'Develop' })).toBe(
      "T-12 “Fix the login” is blocked at Develop: SLOP BOX's turn could not start or failed",
    );
    expect(say('task_blocked', { about: 'g', task: 't' })).toBe(
      "T-12 “Fix the login” is blocked: SLOP BOX's turn could not start or failed",
    );
  });

  it('points at the task’s page, or the tasks when it is not found', () => {
    expect(noticePath('task_done', { about: 'g', task: 't' }, names)).toBe('tasks/T-12');
    expect(noticePath('task_escalated', { about: 'g' }, names)).toBe('tasks');
  });
});

describe('noticePath', () => {
  it('points at the chart, the people, an agent’s page, or nowhere once access is gone', () => {
    expect(noticePath('manager_changed', { about: 'm' }, names)).toBe('structure');
    expect(noticePath('report_added', { about: 'm' }, names)).toBe('structure');
    expect(noticePath('role_changed', { about: 'm' }, names)).toBe('structure/people');
    expect(noticePath('invitation_accepted', { about: 'm' }, names)).toBe('structure/people');
    expect(noticePath('membership_reactivated', { about: 'm' }, names)).toBe('structure/people');
    expect(noticePath('agent_paused', { about: 'g' }, names)).toBe('agents/slop-box');
    expect(noticePath('agent_archived', { about: 'gone' }, names)).toBe('structure/agents');
    expect(noticePath('membership_removed', { about: 'm' }, names)).toBeNull();
    expect(noticePath('membership_suspended', { about: 'm' }, names)).toBeNull();
  });
});

describe('sign_in_needed (T-22)', () => {
  const signIn = (signInKind: string | undefined, detail?: string): NoticePayload => ({
    about: 'm',
    signIn: 's',
    change: '2026-11-14T10:00:00.000Z',
    ...(signInKind === undefined ? {} : { signInKind }),
    ...(detail === undefined ? {} : { detail }),
  });

  it('names the sign-in and its provider, a GitHub login to sign in again and a token to add again', () => {
    expect(say('sign_in_needed', signIn('slack_bot_token', 'Slack Airia Bro'))).toBe(
      "'Slack Airia Bro' stopped working: Slack refused its token. Add it again",
    );
    expect(say('sign_in_needed', signIn('slack_user_token', 'Ihor in Slack'))).toBe(
      "'Ihor in Slack' stopped working: Slack refused its token. Add it again",
    );
    expect(say('sign_in_needed', signIn('github_oauth', 'GitHub login'))).toBe(
      "'GitHub login' stopped working: GitHub refused its sign-in. Sign in again",
    );
    expect(say('sign_in_needed', signIn('github_token', 'Classic'))).toBe(
      "'Classic' stopped working: GitHub refused its token. Add it again",
    );
    expect(say('sign_in_needed', signIn('atlassian_api_token', 'Jira'))).toBe(
      "'Jira' stopped working: Atlassian refused its token. Add it again",
    );
  });

  it('says "A sign-in of yours" without a label, and "its provider" for a kind it does not know', () => {
    expect(say('sign_in_needed', signIn('slack_bot_token'))).toBe(
      'A sign-in of yours stopped working: Slack refused its token. Add it again',
    );
    expect(say('sign_in_needed', signIn('claude_oauth', 'Claude'))).toBe(
      "'Claude' stopped working: its provider refused its token. Add it again",
    );
    expect(say('sign_in_needed', signIn(undefined))).toBe(
      'A sign-in of yours stopped working: its provider refused its token. Add it again',
    );
  });

  it('points at the person’s sign-ins', () => {
    expect(noticePath('sign_in_needed', signIn('github_oauth', 'GitHub'), names)).toBe('subscriptions');
    expect(noticePath('sign_in_needed', { about: 'm' }, names)).toBe('subscriptions');
  });
});

describe('noticeEmail', () => {
  const company = { name: 'Acme', slug: 'acme' };
  const origin = 'http://localhost:9951';

  it('makes one notice its own subject, with who did it and its link', () => {
    const mail = noticeEmail(
      [{ text: 'You now report to Bob', actor: 'Anna', path: 'structure' }],
      company,
      origin,
    );
    expect(mail.subject).toBe('You now report to Bob');
    expect(mail.text).toBe(
      [
        'You now report to Bob (by Anna).',
        '',
        'Open the app: http://localhost:9951/acme/structure',
        '',
        'You get these emails while email notifications are on for you in Acme; turn them off from the bell in the app.',
        '',
      ].join('\n'),
    );
  });

  it('links to the app’s start after a removal, and cuts a long subject', () => {
    const long = 'x'.repeat(SUBJECT_LENGTH + 10);
    const mail = noticeEmail([{ text: long, actor: null, path: null }], company, origin);
    expect(mail.subject).toHaveLength(SUBJECT_LENGTH);
    expect(mail.subject.endsWith('…')).toBe(true);
    expect(mail.text).toContain(`${long}.\n`);
    expect(mail.text).toContain('Open the app: http://localhost:9951/\n');
  });

  it('counts several in the subject and lists the first few, linking to the chart', () => {
    const lines = ['One', 'Two', 'Three', 'Four', 'Five'].map((text) => ({
      text,
      actor: null,
      path: 'structure/people',
    }));
    const mail = noticeEmail(lines, company, origin);
    expect(mail.subject).toBe('5 changes for you in Acme');
    expect(mail.text.split('\n').slice(0, EMAIL_LINES + 1)).toEqual([
      '- One.',
      '- Two.',
      '- Three.',
      '- and 2 more.',
    ]);
    expect(mail.text).toContain('Open the app: http://localhost:9951/acme/structure\n');
    expect(noticeEmail(lines.slice(0, 2), company, origin).text.split('\n').slice(0, 3)).toEqual([
      '- One.',
      '- Two.',
      '',
    ]);
  });
});
