import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatPath, ended, turnRow } from '../../../../fixtures/chats/world.ts';
import { contactRows, erichDm, erichScene } from '../../../../fixtures/contacts.ts';
import {
  type DecisionsWorld,
  decisionRows,
  decisionsPath,
  decisionsWorld,
} from '../../../../fixtures/decisions/decisions.ts';
import { answerTurn } from '../../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { toolCall } from '../../../../fixtures/tools.ts';

/**
 * A decision's contact (2026-11-14, docs/subscriptions.md "Contacts"): one recorded in a Slack message's turn names its
 * sender's contact; one recorded in a person's message in that Slack chat names the contact who started the
 * conversation; the contact's decisions are listed by `GET …/decisions?contact=`.
 */

let w: DecisionsWorld;
beforeAll(async () => {
  w = await decisionsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.provider.reset();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const DECIDED = { what: 'Restart the deploy', why: 'Erich asked for it and the logs show a stuck job.' };

describe('contactOf', () => {
  it('names the Slack sender’s contact, then the conversation’s for a person’s message in that chat', async () => {
    const s = await erichScene(w, { caps: { agentTools: true, decisions: true } });
    const runner = s.runner as FakeRunner;
    await s.conn.deliver(erichDm());
    const first = await runner.frames.next('turn.start');
    expect((await toolCall(runner, first.turnId, 'record_decision', DECIDED)).ok).toBe(true);
    answerTurn(runner, first, 'Restarted.');
    await ended(w.t.db, first.turnId);
    const [erich] = await contactRows(w.t.db, s.company.companyId);
    const chatId = (await turnRow(w.t.db, first.turnId))?.chatId as string;
    const sent = await as(w, s.company.owner)('POST', chatPath(s.company, chatId, '/turns'), {
      prompt: 'Also clear the cache.',
    });
    expect(sent.status).toBe(202);
    const second = await runner.frames.next('turn.start');
    const cleared = { what: 'Clear the cache', why: 'Ihor asked, in Erich’s conversation.' };
    expect((await toolCall(runner, second.turnId, 'record_decision', cleared)).ok).toBe(true);
    answerTurn(runner, second, 'Cleared.');
    await ended(w.t.db, second.turnId);
    const rows = await decisionRows(w.t.db, chatId);
    expect(rows.map((row) => [row.what, row.contactId])).toEqual([
      ['Restart the deploy', erich?.id],
      ['Clear the cache', erich?.id],
    ]);
    const listed = await as(w, s.company.owner)('GET', decisionsPath(s.company, `?contact=${erich?.id}`));
    expect((listed.body as { decisions: { what: string }[] }).decisions.map((d) => d.what).sort()).toEqual([
      'Clear the cache',
      'Restart the deploy',
    ]);
  });
});
