import { tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { createTestApp, seedCompany, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { turnsRepo } from '../../../../src/modules/chats/repo/turns.ts';

// The turns' reads the routes always reach with rows; the empty cases here (an answer's mark goes after a turn's last
// event, and a question's turn always has one).

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('turnsRepo', () => {
  it('says 0 for the last event of a turn without events, and none for no turns', async () => {
    const { company } = await seedCompany(t.db);
    const scoped = await tenant(t.db, company.id);
    expect(await turnsRepo.lastEventSeq(scoped, newId())).toBe(0);
    expect(await turnsRepo.eventsOf(scoped, [])).toEqual([]);
  });
});
