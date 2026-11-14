import { chatTurns, contacts } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { endTurn } from '../../../fixtures/chats/world.ts';
import {
  contactRows,
  contactsPath,
  ERICH_AVATAR,
  erichDm,
  erichScene,
  wokenAndAnswered,
} from '../../../fixtures/contacts.ts';
import { type InboundWorld, inboundWorld } from '../../../fixtures/integrations/slack-inbound.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';

/**
 * `GET …/contacts/interactions?since=` (2026-11-14, the org chart's Requesters): per contact, the agents their messages
 * woke since `since` (7 days by default, at most 90 back, never ahead), how many and the latest, and whether a turn of
 * theirs waits or runs now; archived contacts left out; members and above.
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

const DAY = 24 * 60 * 60_000;

interface Interactions {
  readonly since: string;
  readonly contacts: {
    readonly contact: Record<string, unknown>;
    readonly live: boolean;
    readonly agents: Record<string, unknown>[];
  }[];
}

const interactions = async (s: Awaited<ReturnType<typeof erichScene>>, query = '') => {
  const res = await as(w, s.company.owner)('GET', `${contactsPath(s.company, 'interactions')}${query}`);
  expect(res.status).toBe(200);
  return res.body as Interactions;
};

describe('the interactions', () => {
  it('count each contact’s messages per agent in the last 7 days, and say who is being answered now', async () => {
    const s = await erichScene(w);
    await wokenAndAnswered(s, w, erichDm());
    const [erich] = await contactRows(w.t.db, s.company.companyId);
    const quiet = await interactions(s);
    expect(quiet.since).toBe(new Date(w.clock().getTime() - 7 * DAY).toISOString());
    expect(quiet.contacts).toEqual([
      {
        contact: {
          id: erich?.id,
          name: 'Erich Stuntebeck',
          avatarUrl: ERICH_AVATAR,
          title: 'Principal Engineer',
        },
        live: false,
        agents: [
          {
            agentId: s.agentId,
            principalId: expect.any(String),
            messages: 1,
            lastAt: expect.any(String),
            live: false,
          },
        ],
      },
    ]);
    await s.conn.deliver(erichDm({ text: 'and the logs?' }));
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    const live = await interactions(s);
    expect(live.contacts[0]).toMatchObject({ live: true, agents: [{ messages: 2, live: true }] });
    endTurn(s.runner as FakeRunner, start.turnId);
  });

  it('leave out messages before the window unless still live, and archived contacts', async () => {
    const s = await erichScene(w);
    await wokenAndAnswered(s, w, erichDm());
    const [erich] = await contactRows(w.t.db, s.company.companyId);
    const before = new Date(w.clock().getTime() - 8 * DAY);
    // A turn's time is the database's; the world's clock is fixed, so the turn is put 8 days before it.
    await rawDb(w.t.db)
      .update(chatTurns)
      .set({ createdAt: before })
      .where(eq(chatTurns.contactId, erich?.id as string));
    expect((await interactions(s)).contacts).toEqual([]);
    const month = new Date(w.clock().getTime() - 30 * DAY).toISOString();
    expect(
      (await interactions(s, `?since=${encodeURIComponent(month)}`)).contacts[0]?.agents[0],
    ).toMatchObject({
      messages: 1,
    });
    await rawDb(w.t.db)
      .update(contacts)
      .set({ archivedAt: w.clock() })
      .where(eq(contacts.id, erich?.id as string));
    expect((await interactions(s, `?since=${encodeURIComponent(month)}`)).contacts).toEqual([]);
  });

  it('keep `since` within 90 days back and now, and refuse viewers and a malformed since', async () => {
    const s = await erichScene(w);
    const now = w.clock().getTime();
    const ahead = new Date(now + DAY).toISOString();
    expect((await interactions(s, `?since=${encodeURIComponent(ahead)}`)).since).toBe(
      new Date(now).toISOString(),
    );
    const year = new Date(now - 365 * DAY).toISOString();
    expect((await interactions(s, `?since=${encodeURIComponent(year)}`)).since).toBe(
      new Date(now - 90 * DAY).toISOString(),
    );
    const bad = await as(w, s.company.owner)(
      'GET',
      `${contactsPath(s.company, 'interactions')}?since=yesterday`,
    );
    expect(bad.status).toBe(400);
    const viewer = await addMember(w, s.company, 'viewer');
    expect((await as(w, viewer)('GET', contactsPath(s.company, 'interactions'))).status).toBe(403);
  });
});
