import { describe, expect, it } from 'vitest';
import { noteOf, personFields, seenChanges, windowStart } from '../../../src/modules/contacts/rules.ts';

/** The contacts' pure rules (2026-11-14): a Slack person's fields as kept, what a sighting changes, the note, the window. */

const PERSON = {
  teamId: 'T0AIRIA',
  userId: 'U0ERICH',
  name: '  Erich   Stuntebeck ',
  avatarUrl: 'https://avatars.slack-edge.com/erich_72.png',
  title: 'Principal Engineer',
  email: 'erich@airia.test',
  handle: 'erich',
};

describe('personFields', () => {
  it('trims and keeps a person’s fields', () => {
    expect(personFields(PERSON)).toEqual({
      name: 'Erich Stuntebeck',
      avatarUrl: PERSON.avatarUrl,
      title: 'Principal Engineer',
      email: 'erich@airia.test',
      handle: 'erich',
    });
  });

  it('gives no name for a blank one or their id, and drops an avatar not at https, a bad email and blanks; cuts long ones', () => {
    for (const avatarUrl of ['http://a.test/x.png', 'not a url', `https://a.test/${'x'.repeat(500)}`])
      expect(personFields({ ...PERSON, avatarUrl }).avatarUrl).toBeNull();
    expect(personFields({ ...PERSON, name: ' ', email: 'nobody', title: '', handle: null })).toMatchObject({
      name: null,
      email: null,
      title: null,
      handle: null,
    });
    expect(personFields({ ...PERSON, name: 'U0ERICH' }).name).toBeNull();
    expect(personFields({ ...PERSON, title: 't'.repeat(300) }).title).toHaveLength(200);
  });
});

describe('seenChanges', () => {
  const row = {
    name: 'Erich Stuntebeck',
    avatarUrl: null,
    title: 'Engineer',
    email: null,
    handle: 'erich',
    lastSeenAt: new Date(Date.UTC(2026, 10, 14, 9)),
  };
  const later = new Date(Date.UTC(2026, 10, 14, 10));

  it('takes what differs, never blanks, and moves last seen only forward', () => {
    const fields = { name: 'Erich Stuntebeck', avatarUrl: null, title: 'CTO', email: null, handle: null };
    expect(seenChanges(row, fields, later)).toEqual({
      set: { title: 'CTO', lastSeenAt: later },
      changed: true,
    });
    expect(seenChanges(row, { ...fields, title: 'Engineer' }, row.lastSeenAt)).toEqual({
      set: {},
      changed: false,
    });
  });
});

describe('noteOf and windowStart', () => {
  it('keep a note’s lines, trimmed; blank removes it', () => {
    expect(noteOf('  one\r\ntwo  ')).toBe('one\ntwo');
    expect(noteOf('   ')).toBeNull();
    expect(noteOf(null)).toBeNull();
  });

  it('start the window 7 days back by default, else at since within 90 days back and now', () => {
    const now = new Date(Date.UTC(2026, 10, 14, 12));
    const day = 24 * 60 * 60_000;
    expect(windowStart(undefined, now)).toEqual(new Date(now.getTime() - 7 * day));
    expect(windowStart(new Date(now.getTime() - day).toISOString(), now)).toEqual(
      new Date(now.getTime() - day),
    );
    expect(windowStart('2020-01-01T00:00:00Z', now)).toEqual(new Date(now.getTime() - 90 * day));
    expect(windowStart('2030-01-01T00:00:00Z', now)).toEqual(now);
  });
});
