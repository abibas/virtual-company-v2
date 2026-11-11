import { describe, expect, it } from 'vitest';
import type { InboxItem } from '../../src/api/inbox.ts';
import { inboxText } from '../../src/inbox/render.ts';

const question: InboxItem = {
  id: 'question:1',
  kind: 'question',
  company: { id: 'c1', slug: 'acme', name: 'Acme' },
  title: 'Which database should the service use?',
  subtitle: 'SLOP BOX · Set up the service',
  reason: null,
  from: { principalId: 'p1', kind: 'agent', name: 'SLOP BOX', slug: 'slop-box' },
  link: 'chats/a1?chat=c9',
  actions: ['answer'],
  task: null,
  at: '2026-11-11T10:02:33.000Z',
};

describe('inboxText', () => {
  it('shows a question without a key, and a kind or a mover it does not know as it comes', () => {
    const later = { ...question, id: 'x', kind: 'review', from: null, actions: [] };
    expect(inboxText([question, later], 'Acme')).toBe(
      [
        'KIND      KEY  TITLE                                   WHERE                          FROM      SINCE             YOU MAY',
        'Question  -    Which database should the service use?  SLOP BOX · Set up the service  SLOP BOX  2026-11-11 10:02  answer',
        'review    -    Which database should the service use?  SLOP BOX · Set up the service  -         2026-11-11 10:02  -',
        '',
      ].join('\n'),
    );
  });
});
