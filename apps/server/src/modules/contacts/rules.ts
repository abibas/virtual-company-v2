import type { Contact } from '@mwc/db';
import {
  CONTACT_EMAIL_MAX,
  CONTACT_HANDLE_MAX,
  CONTACT_INTERACTIONS,
  CONTACT_NAME_MAX,
  CONTACT_TITLE_MAX,
  CONTACT_URL_MAX,
} from '@mwc/shared/contacts';
import type { ContactView } from './schemas.ts';

/**
 * The contacts' pure rules (2026-11-14, docs/subscriptions.md "Contacts"): a Slack person as a contact keeps them
 * (trimmed and cut to the limits, an avatar only at an `https` address, an email only when it looks like one), what a
 * new message of theirs changes (what Slack gave that differs, never blanked; last seen only forward), a contact as the
 * API shows it, and the interactions window (7 days by default, at most 90 back, never ahead).
 */

const DAY_MS = 24 * 60 * 60_000;

/** A Slack person as a message of theirs showed them (`users.info`, else the connection's listed person). */
export interface SlackPersonSeen {
  readonly teamId: string;
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly title: string | null;
  readonly email: string | null;
  readonly handle: string | null;
}

/** The fields a contact keeps of a person. */
export interface PersonFields {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly title: string | null;
  readonly email: string | null;
  readonly handle: string | null;
}

/** A text trimmed and cut to `max`; null when blank. */
function cut(value: string | null, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text === '' ? null : text.slice(0, max).trimEnd();
}

/** An `https` address of at most the limit; null for anything else. */
function httpsUrl(value: string | null): string | null {
  if (value === null || value.length > CONTACT_URL_MAX) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The fields kept of a Slack person (see above); a person with no name is named by their Slack id. */
export function personFields(person: SlackPersonSeen): PersonFields {
  const email = cut(person.email, CONTACT_EMAIL_MAX);
  return {
    name: cut(person.name, CONTACT_NAME_MAX) ?? person.userId,
    avatarUrl: httpsUrl(person.avatarUrl),
    title: cut(person.title, CONTACT_TITLE_MAX),
    email: email !== null && EMAIL.test(email) ? email : null,
    handle: cut(person.handle, CONTACT_HANDLE_MAX),
  };
}

/** What a new message changes on a contact: the fields that differ (never blanked), and last seen moved forward. */
export function seenChanges(
  row: Pick<Contact, keyof PersonFields | 'lastSeenAt'>,
  fields: PersonFields,
  at: Date,
): { readonly set: Partial<PersonFields> & { readonly lastSeenAt?: Date }; readonly changed: boolean } {
  const set: Partial<Record<keyof PersonFields, string>> = {};
  for (const key of ['name', 'avatarUrl', 'title', 'email', 'handle'] as const) {
    const value = fields[key];
    if (value !== null && value !== row[key]) set[key] = value;
  }
  const changed = Object.keys(set).length > 0;
  return { set: at > row.lastSeenAt ? { ...set, lastSeenAt: at } : set, changed };
}

/** The audited fields of a contact. */
export const auditedContact = (row: Contact) => ({
  name: row.name,
  avatarUrl: row.avatarUrl,
  title: row.title,
  email: row.email,
  handle: row.handle,
  note: row.note,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

/** A contact as the API shows it. */
export function contactView(row: Contact): ContactView {
  const slack =
    row.slackTeamId !== null && row.slackUserId !== null
      ? { teamId: row.slackTeamId, userId: row.slackUserId }
      : null;
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    avatarUrl: row.avatarUrl,
    email: row.email,
    title: row.title,
    handle: row.handle,
    slack,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    note: row.note,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** The note as it is kept: trimmed, its lines kept; blank or null removes it. */
export function noteOf(note: string | null): string | null {
  const text = note?.replace(/\r\n/g, '\n').trim() ?? '';
  return text === '' ? null : text;
}

/** The interactions window's start: `since` within 90 days back and now, else 7 days ago. */
export function windowStart(since: string | undefined, now: Date): Date {
  const earliest = now.getTime() - CONTACT_INTERACTIONS.maxDays * DAY_MS;
  if (since === undefined) return new Date(now.getTime() - CONTACT_INTERACTIONS.defaultDays * DAY_MS);
  const asked = new Date(since).getTime();
  return new Date(Math.min(now.getTime(), Math.max(earliest, asked)));
}
