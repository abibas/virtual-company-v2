import { contacts } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { endTurn } from '../../../fixtures/chats/world.ts';
import {
  contactRows,
  contactsPath,
  ERICH,
  ERICH_AVATAR,
  erichDm,
  erichScene,
  wokenAndAnswered,
} from '../../../fixtures/contacts.ts';
import {
  BOT,
  type InboundScene,
  type InboundWorld,
  inboundWorld,
  message,
  otherAgent,
} from '../../../fixtures/integrations/slack-inbound.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import { auditTrail } from '../../../fixtures/org.ts';

/**
 * A company's contacts over the API (2026-11-14, docs/subscriptions.md "Contacts"): the list (members and above, the
 * latest seen first, archived ones only when asked) with the agents each talked to; a contact's page with their
 * conversations (each chat's agent, last message, place and whether a turn runs there) and the counts per agent; the
 * note and archive (admins and owners, audited); viewers refused, another company's contact the same 404 as none.
 */

let w: InboundWorld;

beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(() => {
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

interface Detail {
  readonly contact: Record<string, unknown>;
  readonly conversations: Record<string, unknown>[];
  readonly agents: Record<string, unknown>[];
}

/** A scene where Erich DMed its agent once (answered "On it.") and asked Developer in #general; his contact's id. */
async function talked(): Promise<{ s: InboundScene; contactId: string; developer: { id: string } }> {
  const s = await erichScene(w);
  const developer = await otherAgent(w, s, 'Developer', true);
  await wokenAndAnswered(s, w, erichDm());
  w.clock.advance(60_000);
  await wokenAndAnswered(
    s,
    w,
    message({ user: ERICH, text: `<@${BOT}> @developer check the logs` }),
    'Done.',
  );
  const [row] = await contactRows(w.t.db, s.company.companyId);
  return { s, contactId: row?.id as string, developer };
}

describe('the list', () => {
  it('shows each contact with the agents they talked to, the latest first; archived ones only when asked', async () => {
    const { s, contactId, developer } = await talked();
    const member = await addMember(w, s.company, 'member');
    const res = await as(w, member)('GET', contactsPath(s.company));
    expect(res.status).toBe(200);
    expect((res.body as { contacts: unknown[] }).contacts).toEqual([
      expect.objectContaining({
        id: contactId,
        name: 'Erich Stuntebeck',
        avatarUrl: ERICH_AVATAR,
        slack: { teamId: 'T0FAKE', userId: ERICH },
        agentIds: [developer.id, s.agentId],
        conversations: 2,
        archivedAt: null,
      }),
    ]);
    await rawDb(w.t.db).update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, contactId));
    expect((await as(w, member)('GET', contactsPath(s.company))).body).toEqual({ contacts: [] });
    const all = await as(w, member)('GET', `${contactsPath(s.company)}?archived=true`);
    expect((all.body as { contacts: { id: string }[] }).contacts.map((c) => c.id)).toEqual([contactId]);
  });

  it('refuses viewers, and lists none for a company with no contacts', async () => {
    const s = await erichScene(w);
    const viewer = await addMember(w, s.company, 'viewer');
    expect((await as(w, viewer)('GET', contactsPath(s.company))).status).toBe(403);
    expect((await as(w, s.company.owner)('GET', contactsPath(s.company))).body).toEqual({ contacts: [] });
  });
});

describe('a contact’s page', () => {
  it('lists their conversations, the latest first, with each agent, last message and place, and counts per agent', async () => {
    const { s, contactId, developer } = await talked();
    const res = await as(w, s.company.owner)('GET', contactsPath(s.company, contactId));
    expect(res.status).toBe(200);
    const detail = res.body as Detail;
    expect(detail.contact).toMatchObject({ id: contactId, title: 'Principal Engineer', handle: 'erich' });
    expect(detail.conversations).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ id: developer.id, name: 'Developer' }),
        place: '#general',
        last: expect.objectContaining({ by: 'agent', text: 'Done.' }),
        live: false,
        archived: false,
      }),
      expect.objectContaining({
        agent: expect.objectContaining({ id: s.agentId }),
        place: 'a DM',
        last: expect.objectContaining({ by: 'agent', text: 'On it.' }),
      }),
    ]);
    expect(detail.agents).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ id: developer.id }),
        conversations: 1,
        messages: 1,
      }),
      expect.objectContaining({
        agent: expect.objectContaining({ id: s.agentId }),
        conversations: 1,
        messages: 1,
      }),
    ]);
  });

  it('shows their own message as the last one, and the conversation live, while the agent works', async () => {
    const s = await erichScene(w);
    await wokenAndAnswered(s, w, erichDm());
    await s.conn.deliver(erichDm({ text: 'and   the\nlogs?' }));
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    const [row] = await contactRows(w.t.db, s.company.companyId);
    const detail = (await as(w, s.company.owner)('GET', contactsPath(s.company, row?.id))).body as Detail;
    expect(detail.conversations[0]).toMatchObject({
      live: true,
      last: { by: 'contact', text: 'and the logs?' },
    });
    expect(detail.agents[0]).toMatchObject({ conversations: 1, messages: 2 });
    endTurn(s.runner as FakeRunner, start.turnId);
  });

  it('is the same 404 for an unknown, a malformed and another company’s contact; viewers are refused', async () => {
    const { s, contactId } = await talked();
    const other = await erichScene(w);
    const viewer = await addMember(w, s.company, 'viewer');
    for (const id of ['019a8b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c', 'not-an-id']) {
      const res = await as(w, s.company.owner)('GET', contactsPath(s.company, id));
      expect([res.status, (res.body as { error: { code: string } }).error.code]).toEqual([
        404,
        'contact_not_found',
      ]);
    }
    expect((await as(w, other.company.owner)('GET', contactsPath(other.company, contactId))).status).toBe(
      404,
    );
    expect((await as(w, viewer)('GET', contactsPath(s.company, contactId))).status).toBe(403);
  });
});

describe('the note and archive', () => {
  it('let admins keep a note, archive and bring back a contact, each audited as them', async () => {
    const { s, contactId } = await talked();
    const admin = await addMember(w, s.company, 'admin');
    const path = contactsPath(s.company, contactId);
    const noted = await as(w, admin)('PATCH', path, { note: '  Asks for deploy checks.\nPrefers DMs.  ' });
    expect(noted.status).toBe(200);
    expect(noted.body).toMatchObject({ id: contactId, note: 'Asks for deploy checks.\nPrefers DMs.' });
    const archived = await as(w, admin)('PATCH', path, { archived: true });
    expect((archived.body as { archivedAt: string | null }).archivedAt).toBe(w.clock().toISOString());
    expect((await as(w, admin)('PATCH', path, { archived: false, note: ' ' })).body).toMatchObject({
      archivedAt: null,
      note: null,
    });
    const trail = await auditTrail(w.t.db, 'contact', contactId);
    expect(trail.filter(([action]) => action !== 'create')).toEqual([
      ['update', 'note', null, 'Asks for deploy checks.\nPrefers DMs.'],
      ['archive', 'archivedAt', null, w.clock().toISOString()],
      ['unarchive', 'archivedAt', w.clock().toISOString(), null],
      ['unarchive', 'note', 'Asks for deploy checks.\nPrefers DMs.', null],
    ]);
  });

  it('writes nothing for a change that changes nothing, and refuses members, an empty body and an unknown contact', async () => {
    const { s, contactId } = await talked();
    const member = await addMember(w, s.company, 'member');
    const path = contactsPath(s.company, contactId);
    const before = (await auditTrail(w.t.db, 'contact', contactId)).length;
    expect((await as(w, s.company.owner)('PATCH', path, { archived: false, note: null })).status).toBe(200);
    expect(await auditTrail(w.t.db, 'contact', contactId)).toHaveLength(before);
    expect((await as(w, member)('PATCH', path, { note: 'x' })).status).toBe(403);
    expect((await as(w, s.company.owner)('PATCH', path, {})).status).toBe(400);
    expect((await as(w, s.company.owner)('PATCH', path, { note: 'x'.repeat(2001) })).status).toBe(400);
    const unknown = contactsPath(s.company, '019a8b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c');
    expect((await as(w, s.company.owner)('PATCH', unknown, { note: 'x' })).status).toBe(404);
  });
});
