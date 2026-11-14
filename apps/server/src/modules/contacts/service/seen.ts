import { auditChanges, type Contact, diffFields, type TenantDb } from '@mwc/db';
import { contactsRepo as repo } from '../repo.ts';
import {
  auditedContact,
  type PersonFields,
  personFields,
  type SlackPersonSeen,
  seenChanges,
} from '../rules.ts';

/**
 * A Slack person seen by the company (2026-11-14, docs/subscriptions.md "Contacts"): the integrations module calls it
 * when their message wakes one of the company's agents. The first time, their contact is made (audited as Most Wanted,
 * `create`); after that it takes what Slack gave this time that differs (the name, avatar, title, email and handle,
 * never blanked; audited `update`) and moves last seen forward. An archived contact stays archived. Two messages at
 * once (two Slack connections of one workspace) make one contact.
 */

/** Updates a contact from a sighting (see above); the row as it is now. */
async function seenAgain(t: TenantDb, row: Contact, fields: PersonFields, at: Date): Promise<Contact> {
  const { set, changed } = seenChanges(row, fields, at);
  if (Object.keys(set).length === 0) return row;
  const updated = (await repo.update(t, row.id, set)) ?? row;
  if (changed) {
    const changes = diffFields(auditedContact(row), auditedContact(updated));
    await auditChanges(t, {
      actorKind: 'system',
      entityType: 'contact',
      entityId: row.id,
      action: 'update',
      changes,
    });
  }
  return updated;
}

/** The contact of a Slack person whose message woke an agent at `at`, made or brought up to date (see above). */
export async function seenOnSlack(t: TenantDb, person: SlackPersonSeen, at: Date): Promise<Contact> {
  const fields = personFields(person);
  const found = await repo.bySlack(t, person.teamId, person.userId);
  if (found !== undefined) return seenAgain(t, found, fields, at);
  const made = await repo.insert(t, {
    source: 'slack',
    slackTeamId: person.teamId,
    slackUserId: person.userId,
    ...fields,
    firstSeenAt: at,
    lastSeenAt: at,
  });
  if (made === undefined) {
    const raced = (await repo.bySlack(t, person.teamId, person.userId)) as Contact;
    return seenAgain(t, raced, fields, at);
  }
  const changes = diffFields(null, auditedContact(made));
  await auditChanges(t, {
    actorKind: 'system',
    entityType: 'contact',
    entityId: made.id,
    action: 'create',
    changes,
  });
  return made;
}
