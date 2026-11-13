import type { SlackUser } from '@mwc/tools-core';

/**
 * A Slack workspace's people as the "Only these people" search finds them (2026-11-13): each person once with their
 * name, title, email and avatar, and the words they are found by, any case and without accents; a search ranks the
 * people whose name words (first name, last name, display name or handle) start with every typed word first, then
 * those whose names hold the typed text, then those whose email does, each group by name. Bots, deactivated people
 * and Slackbot are no people here. Pure.
 */

/** A person of the directory: as shown, and the words they are found by. */
export interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly email: string | null;
  readonly image: string | null;
  /** Each word of their names, folded. */
  readonly words: readonly string[];
  /** Their names (real, display, handle), folded, one per line. */
  readonly names: string;
  /** Their email, folded; empty without one. */
  readonly mail: string;
}

/** The most people one search gives. */
export const PEOPLE_MAX = 20;

/** Lower case without accents (é → e), spaces kept as they are. */
export const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** A name's words: split on spaces and on the handle's dots, dashes and underscores. */
const wordsOf = (text: string): string[] => text.split(/[\s._\-()/,]+/).filter((word) => word !== '');

/** True for a person (not a bot, deactivated, or Slackbot). */
export const isPerson = (user: SlackUser): boolean => !user.isBot && !user.deleted && user.id !== 'USLACKBOT';

/** The directory's entry for a person of Slack's: their real name first, an https avatar or none. */
export function directoryPerson(user: SlackUser): DirectoryPerson {
  const image = user.image?.startsWith('https://') ? user.image.slice(0, 500) : null;
  const names = [user.realName, user.displayName, user.name].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
  const folded = names.map(fold);
  const email = user.email?.trim() ? user.email.trim().slice(0, 200) : null;
  return {
    id: user.id,
    name: (user.realName?.trim() || user.displayName?.trim() || user.name).slice(0, 120) || user.id,
    title: user.title?.trim() ? user.title.trim().slice(0, 200) : null,
    email,
    image,
    words: [...new Set(folded.flatMap(wordsOf))],
    names: folded.join('\n'),
    mail: email === null ? '' : fold(email),
  };
}

/** How well a person fits the folded query: 0 their name words start with it, 1 a name holds it, 2 the email; else none. */
function rankOf(person: DirectoryPerson, query: string, typed: readonly string[]): number | undefined {
  if (typed.length > 0 && typed.every((word) => person.words.some((own) => own.startsWith(word)))) return 0;
  if (person.names.includes(query)) return 1;
  if (person.mail !== '' && person.mail.includes(query)) return 2;
  return undefined;
}

/** The people fitting `q`, best first (see above), at most `max`. */
export function rankPeople(
  people: readonly DirectoryPerson[],
  q: string,
  max: number = PEOPLE_MAX,
): DirectoryPerson[] {
  const query = fold(q.trim());
  if (query === '') return [];
  const typed = wordsOf(query);
  const ranked: { person: DirectoryPerson; rank: number }[] = [];
  for (const person of people) {
    const rank = rankOf(person, query, typed);
    if (rank !== undefined) ranked.push({ person, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.person.name.localeCompare(b.person.name));
  return ranked.slice(0, max).map((entry) => entry.person);
}

/** True for a whole email address (`name@domain.tld`), which Slack can look up. */
export const isWholeEmail = (q: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q.trim());
