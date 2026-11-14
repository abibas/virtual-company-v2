import { auditLog, chatTurns } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatPath, ended, eventually, turnRow } from '../../../../../fixtures/chats/world.ts';
import {
  contactRows,
  ERICH,
  ERICH_AVATAR,
  erichDm,
  erichInfo,
  erichScene,
  wokenAndAnswered,
} from '../../../../../fixtures/contacts.ts';
import {
  callTool,
  rawUser,
  SLACK_BOT_SCOPES,
  setScopes,
} from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  type InboundWorld,
  inboundWorld,
  message,
  ok,
  putInbound,
  threadRows,
} from '../../../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../../../fixtures/members/members.ts';
import { auditTrail } from '../../../../../fixtures/org.ts';

/**
 * Who a Slack message is from (2026-11-14, docs/subscriptions.md "Contacts"): the first message of an allowed person
 * that wakes an agent makes their contact from Slack (`users.info`: name, avatar, title, email, handle), audited as Most
 * Wanted; the next ones bring it up to date (never a second contact); a person the wake rule ignores, or a bot, makes
 * none. The turn stores the sender, the visible text and the contact (the agent still gets the header), its chat names
 * the contact who started it, and the reply's link is kept once posted (the agent's own post too).
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

const DM_LINK = (ts: string) => `https://airia-fake.slack.com/archives/D0ERICH/p${ts.replace('.', '')}`;

describe('the first message of an allowed person', () => {
  it('makes their contact from Slack, and the turn and the chat name it', async () => {
    const s = await erichScene(w);
    const sent = erichDm();
    const { start, turn } = await wokenAndAnswered(s, w, sent);
    const [erich] = await contactRows(w.t.db, s.company.companyId);
    expect(erich).toMatchObject({
      source: 'slack',
      name: 'Erich Stuntebeck',
      avatarUrl: ERICH_AVATAR,
      title: 'Principal Engineer',
      email: 'erich@airia.test',
      handle: 'erich',
      slackTeamId: 'T0FAKE',
      slackUserId: ERICH,
      note: null,
      archivedAt: null,
    });
    expect(start.spec.prompt).toMatch(/^Slack message from Erich Stuntebeck in a DM with you \(https:/);
    expect(turn).toMatchObject({
      contactId: erich?.id,
      visibleText: 'Can you check the deploy?',
      sender: {
        via: 'slack',
        userId: ERICH,
        name: 'Erich Stuntebeck',
        avatarUrl: ERICH_AVATAR,
        link: DM_LINK(sent.ts),
      },
    });
    const [thread] = (await threadRows(w.t.db)).filter((row) => row.companyId === s.company.companyId);
    expect(thread?.contactId).toBe(erich?.id);
    const trail = await auditTrail(w.t.db, 'contact', erich?.id as string);
    expect(trail).toContainEqual(['create', 'name', null, 'Erich Stuntebeck']);
    expect(trail).toContainEqual(['create', 'title', null, 'Principal Engineer']);
  });

  it('shows in the chat as that person’s message: only their words, their photo, the link and the reply’s link', async () => {
    const s = await erichScene(w);
    const sent = erichDm({ text: 'Hello <@U0BOT>' });
    const { turn } = await wokenAndAnswered(s, w, sent, 'Hi Erich.');
    const chatId = turn?.chatId as string;
    await eventually(
      'the reply’s link is kept',
      async () => (await turnRow(w.t.db, turn?.id as string))?.replyLink != null,
    );
    const detail = await as(w, s.company.owner)('GET', chatPath(s.company, chatId));
    const [view] = (detail.body as { turns: Record<string, unknown>[] }).turns;
    expect(view).toMatchObject({
      visibleText: 'Hello @mw-bot',
      from: {
        name: 'Erich Stuntebeck',
        via: 'slack',
        userId: ERICH,
        avatarUrl: ERICH_AVATAR,
        link: DM_LINK(sent.ts),
      },
      replyLink: 'https://airia-fake.slack.com/archives/C0GENERAL1/p1731499999000100',
    });
    expect(String(view?.prompt)).toContain('Your final reply is posted there under your name.');
    expect((view?.from as { contactId: string }).contactId).toBe(
      (await contactRows(w.t.db, s.company.companyId))[0]?.id,
    );
  });
});

describe('the next messages', () => {
  it('bring the same contact up to date, never a second one, and move last seen', async () => {
    const s = await erichScene(w);
    await wokenAndAnswered(s, w, erichDm());
    const [first] = await contactRows(w.t.db, s.company.companyId);
    w.clock.advance(60_000);
    answerSlack(w, {
      'users.info': erichInfo({ title: 'CTO', image_72: 'https://avatars.slack-edge.com/erich_new.png' }),
    });
    await wokenAndAnswered(s, w, erichDm({ text: 'and the logs?' }));
    const rows = await contactRows(w.t.db, s.company.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first?.id,
      title: 'CTO',
      avatarUrl: 'https://avatars.slack-edge.com/erich_new.png',
    });
    expect(rows[0]?.lastSeenAt.getTime()).toBeGreaterThan(first?.lastSeenAt.getTime() as number);
    expect(rows[0]?.firstSeenAt).toEqual(first?.firstSeenAt);
    expect(await auditTrail(w.t.db, 'contact', first?.id as string)).toContainEqual([
      'update',
      'title',
      'Principal Engineer',
      'CTO',
    ]);
  });

  it('keep what Slack no longer says, and write no audit when nothing but last seen changed', async () => {
    const s = await erichScene(w);
    await wokenAndAnswered(s, w, erichDm());
    const [first] = await contactRows(w.t.db, s.company.companyId);
    await setScopes(
      w.t.db,
      s.signIn.id,
      SLACK_BOT_SCOPES.filter((scope) => scope !== 'users:read'),
    );
    await putInbound(w, s, { inbound: true });
    const conn = w.sockets.latest();
    answerSlack(w, { 'users.info': erichInfo() });
    await wokenAndAnswered({ ...s, conn }, w, erichDm({ text: 'still there?' }));
    const [row] = await contactRows(w.t.db, s.company.companyId);
    expect(row).toMatchObject({ name: 'Erich S.', title: 'Principal Engineer', email: 'erich@airia.test' });
    expect(row?.avatarUrl).toBe('https://avatars.slack-edge.com/erich_listed.png');
    const updates = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, first?.id as string), eq(auditLog.action, 'update')));
    expect(updates.map((update) => update.field).sort()).toEqual(['avatarUrl', 'name']);
  });
});

describe('who makes no contact', () => {
  it('a person the wake rule ignores, and a bot', async () => {
    const s = await erichScene(w);
    await s.conn.deliver(erichDm({ user: 'U0STRANGER' }));
    await s.conn.deliver(erichDm({ user: null, botId: 'B0OTHER', subtype: 'bot_message' }));
    expect(await contactRows(w.t.db, s.company.companyId)).toEqual([]);
    const turns = await rawDb(w.t.db)
      .select()
      .from(chatTurns)
      .where(eq(chatTurns.companyId, s.company.companyId));
    expect(turns.filter((turn) => turn.system)).toEqual([]);
  });

  it('anyone allowed makes theirs, each once per company', async () => {
    const s = await erichScene(w);
    await putInbound(w, s, { wake: 'anyone' });
    const conn = w.sockets.latest();
    const ihor = ok({ user: rawUser('U0IHOR', 'ihor', { real_name: 'Ihor Herasko' }) });
    answerSlack(w, { 'users.info': [erichInfo(), ihor] });
    await wokenAndAnswered({ ...s, conn }, w, erichDm());
    await wokenAndAnswered({ ...s, conn }, w, message({ text: '<@U0BOT> hi from #general' }));
    const rows = await contactRows(w.t.db, s.company.companyId);
    expect(rows.map((row) => [row.slackUserId, row.name])).toEqual([
      [ERICH, 'Erich Stuntebeck'],
      ['U0IHOR', 'Ihor Herasko'],
    ]);
  });
});

describe('the reply’s link', () => {
  it('is the agent’s own post when it replied in the conversation itself', async () => {
    const s = await erichScene(w);
    const sent = erichDm();
    await s.conn.deliver(sent);
    const runner = s.runner as FakeRunner;
    const start = await runner.frames.next('turn.start');
    answerSlack(w, { 'chat.postMessage': ok({ channel: 'D0ERICH', ts: '1731491111.000200' }) });
    const posted = await callTool(s, start, 'slack_post_message', {
      channel_id: 'D0ERICH',
      text: 'Checking now.',
    });
    expect(posted.ok).toBe(true);
    answerTurn(runner, start, 'I posted in the DM.');
    await ended(w.t.db, start.turnId);
    await eventually(
      'the link is kept',
      async () => (await turnRow(w.t.db, start.turnId))?.replyLink != null,
    );
    expect((await turnRow(w.t.db, start.turnId))?.replyLink).toBe(DM_LINK('1731491111.000200'));
  });
});
