import { auditLog, credentials, slackConnections } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { usesOf } from '../../../../../fixtures/chats/world.ts';
import {
  APP_TOKEN,
  connectionRow,
  type InboundWorld,
  inboundPath,
  inboundScene,
  inboundWorld,
  putInbound,
} from '../../../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../../../fixtures/members/members.ts';
import { revokeSubscription } from '../../../../../fixtures/org.ts';

/**
 * The server's Slack connections (2026-11-13) on a fake Socket Mode: a bot sign-in with its app token and receiving on
 * gets one, opened with that token (sealed, never shown or audited) and the bot sign-in opened for `socket_mode`; its
 * statuses are written for the card; receiving off, a removed token, a new token, a renewed sign-in and the sync every 5
 * minutes open, reopen or close it; a revoked sign-in or a token that does not open says so in words.
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

const OTHER_TOKEN = 'xapp-1-A0FAKE-1234567890-OTHERappTOKENnever';
const view = (s: Awaited<ReturnType<typeof inboundScene>>) =>
  as(w, s.company.owner)('GET', inboundPath(s.signIn.id));

describe('a connection', () => {
  it('opens with the sealed app token and writes its statuses for the card', async () => {
    const s = await inboundScene(w);
    expect(s.conn.appToken).toBe(APP_TOKEN);
    expect(s.conn.closed).toBe(false);
    expect((await usesOf(w.t.db, s.signIn.id)).map((use) => use.purpose)).toContain('socket_mode');
    s.conn.say('connecting');
    s.conn.say('connected');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await view(s)).body).toMatchObject({ status: 'connected', statusMessage: null, appToken: true });
    s.conn.say('disconnected', 'Slack closed the connection. Trying again in 1 s.');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await view(s)).body).toMatchObject({
      status: 'disconnected',
      statusMessage: 'Slack closed the connection. Trying again in 1 s.',
    });
  });

  it('keeps the app token sealed: never in the row as text, an answer or an audit row', async () => {
    const s = await inboundScene(w);
    const row = await connectionRow(w.t.db, s.signIn.id);
    expect(Buffer.from(row?.appCiphertext as Uint8Array).toString('utf8')).not.toContain('APPtoken');
    expect(JSON.stringify((await view(s)).body)).not.toContain('xapp-');
    const audit = await rawDb(w.t.db).select().from(auditLog).where(eq(auditLog.entityId, s.signIn.id));
    expect(audit.map((entry) => entry.field)).toContain('appToken');
    expect(JSON.stringify(audit)).not.toContain('xapp-');
  });

  it('closes when receiving is turned off, and opens again when it is on', async () => {
    const s = await inboundScene(w);
    expect((await putInbound(w, s, { inbound: false })).body).toMatchObject({
      status: 'off',
      inbound: false,
    });
    expect(s.conn.closed).toBe(true);
    s.conn.say('error', 'too late');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await connectionRow(w.t.db, s.signIn.id))?.status).toBe('off');
    const opened = w.sockets.opened.length;
    const on = await putInbound(w, s, { inbound: true });
    expect(on.status).toBe(200);
    expect(w.sockets.opened).toHaveLength(opened + 1);
  });

  it('reopens with a new app token, not for other changes, and closes when the token is removed', async () => {
    const s = await inboundScene(w);
    const opened = w.sockets.opened.length;
    expect((await putInbound(w, s, { maxPerHour: 10 })).status).toBe(200);
    expect(w.sockets.opened).toHaveLength(opened);
    expect((await putInbound(w, s, { appToken: OTHER_TOKEN })).status).toBe(200);
    expect(s.conn.closed).toBe(true);
    expect(w.sockets.latest().appToken).toBe(OTHER_TOKEN);
    const removed = await putInbound(w, s, { appToken: null });
    expect(removed.body).toMatchObject({ appToken: false, inbound: false, status: 'off' });
    expect(w.sockets.latest().closed).toBe(true);
  });
});

describe('the sync every 5 minutes', () => {
  it('closes what was turned off elsewhere, opens what was turned on, and reopens for a renewed sign-in', async () => {
    const s = await inboundScene(w);
    expect(w.timers.pending()).toEqual([5 * 60_000]);
    await w.timers.fire();
    expect(s.conn.closed).toBe(false);
    const set = (inbound: boolean) =>
      rawDb(w.t.db)
        .update(slackConnections)
        .set({ inbound })
        .where(eq(slackConnections.credentialId, s.signIn.id));
    await set(false);
    await w.timers.fire();
    expect(s.conn.closed).toBe(true);
    await set(true);
    await w.timers.fire();
    const reopened = w.sockets.latest();
    expect(reopened).not.toBe(s.conn);
    expect(reopened.closed).toBe(false);
    await rawDb(w.t.db)
      .update(credentials)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(credentials.id, s.signIn.id));
    await w.timers.fire();
    expect(reopened.closed).toBe(true);
    expect(w.sockets.latest()).not.toBe(reopened);
    expect(w.timers.pending()).toEqual([5 * 60_000]);
  });
});

describe('a connection that cannot open', () => {
  it('says an app token that does not open in words, and refuses changes to a revoked sign-in', async () => {
    const s = await inboundScene(w);
    await revokeSubscription(w.t.db, s.signIn.id);
    await rawDb(w.t.db)
      .update(slackConnections)
      .set({ appIv: new Uint8Array(12) })
      .where(eq(slackConnections.credentialId, s.signIn.id));
    await w.timers.fire();
    expect(await connectionRow(w.t.db, s.signIn.id)).toMatchObject({
      status: 'error',
      statusMessage: 'The app-level token does not open on this server: paste it again.',
    });
    await rawDb(w.t.db)
      .update(slackConnections)
      .set({ inbound: false })
      .where(eq(slackConnections.credentialId, s.signIn.id));
    const again = await putInbound(w, s, { appToken: OTHER_TOKEN, inbound: true });
    expect(again.status).toBe(422);
  });

  it('says a sign-in revoked after the token was saved in words', async () => {
    const s = await inboundScene(w);
    await revokeSubscription(w.t.db, s.signIn.id);
    await rawDb(w.t.db)
      .update(credentials)
      .set({ updatedAt: new Date(Date.now() + 120_000) })
      .where(eq(credentials.id, s.signIn.id));
    await w.timers.fire();
    expect(await connectionRow(w.t.db, s.signIn.id)).toMatchObject({
      status: 'error',
      statusMessage: expect.stringContaining('was revoked'),
    });
  });
});
