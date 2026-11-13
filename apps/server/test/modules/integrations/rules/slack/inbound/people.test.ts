import { describe, expect, it } from 'vitest';
import {
  directoryPerson,
  fold,
  isPerson,
  isWholeEmail,
  rankPeople,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/people.ts';
import { slackUser as user } from '../../../../../fixtures/integrations/slack-people.ts';

/** The workspace's people as the "Only these people" search finds and ranks them (2026-11-13). */

const people = [
  user('U0ERIK', 'erik.s', { realName: 'Erik Svensson', email: 'erik@airia.com', title: 'Engineer' }),
  user('U0HERI', 'heri', { realName: 'Valeria Herich', email: 'v.herich@airia.com' }),
  user('U0MERI', 'mary', { realName: 'Mary Smith', email: 'mary@eriksson.io' }),
  user('U0ERIN', 'erin', { realName: 'Érin Ó Brien', displayName: 'Erin' }),
  user('U0ANNA', 'anna', { realName: 'Anna Lee' }),
].map(directoryPerson);

const ids = (q: string, max?: number) => rankPeople(people, q, max).map((person) => person.id);

describe('the directory entry', () => {
  it('shows the real name first, an https avatar, a trimmed title and email, and its folded words', () => {
    expect(
      directoryPerson(
        user('U1', 'jo.de-la_cruz', {
          realName: '  ',
          displayName: 'José',
          title: ' CTO ',
          email: ' Jo@X.io ',
          image: 'https://a.slack-edge.com/1.png',
        }),
      ),
    ).toEqual({
      id: 'U1',
      name: 'José',
      title: 'CTO',
      email: 'Jo@X.io',
      image: 'https://a.slack-edge.com/1.png',
      words: ['jose', 'jo', 'de', 'la', 'cruz'],
      names: 'jose\njo.de-la_cruz',
      mail: 'jo@x.io',
    });
    const bare = directoryPerson(user('U2', 'ann', { image: 'http://x', title: ' ', email: '' }));
    expect(bare).toMatchObject({ name: 'ann', image: null, title: null, email: null, mail: '' });
    expect(directoryPerson(user('U3', '')).name).toBe('U3');
  });

  it('is a person: not a bot, deactivated, or Slackbot', () => {
    expect(isPerson(user('U1', 'a'))).toBe(true);
    expect(isPerson(user('U1', 'a', { isBot: true }))).toBe(false);
    expect(isPerson(user('U1', 'a', { deleted: true }))).toBe(false);
    expect(isPerson(user('USLACKBOT', 'slackbot'))).toBe(false);
  });
});

describe('the ranking', () => {
  it('puts names whose words start with the words first, then names holding them, then emails', () => {
    // Erik and Erin start with "eri"; Valeria Herich holds it; Mary has it only in her email.
    expect(ids('eri')).toEqual(['U0ERIK', 'U0ERIN', 'U0HERI', 'U0MERI']);
    expect(ids('ERI', 2)).toEqual(['U0ERIK', 'U0ERIN']);
  });

  it('matches every typed word to a name word, any order, ignoring case and accents', () => {
    expect(ids('bri erin')).toEqual(['U0ERIN']);
    expect(ids('érin')).toEqual(['U0ERIN']);
    expect(ids('svens')).toEqual(['U0ERIK']);
    expect(ids('erik.s')).toEqual(['U0ERIK']);
  });

  it('finds by email, and nothing for no words or no match', () => {
    expect(ids('v.herich@')).toEqual(['U0HERI']);
    expect(ids('eriksson.io')).toEqual(['U0MERI']);
    expect(ids('   ')).toEqual([]);
    expect(ids('zzz')).toEqual([]);
  });

  it('folds case and accents', () => {
    expect(fold('Ólafur ÉRIK')).toBe('olafur erik');
  });

  it('knows a whole email', () => {
    expect(isWholeEmail(' ihor@airia.com ')).toBe(true);
    expect(isWholeEmail('ihor@airia')).toBe(false);
    expect(isWholeEmail('ihor@')).toBe(false);
    expect(isWholeEmail('ihor herasko@airia.com')).toBe(false);
  });
});
