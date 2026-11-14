/**
 * Contacts' test helpers (2026-11-14): a Slack person (Erich) as `users.info` gives him, a scene whose bot sign-in lets
 * him wake its agent, a message of his delivered and its turn answered, and the contacts' rows and paths. Never a real
 * Slack: Socket Mode is the fake, the Web API the fake provider.
 */
import { contacts, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import type { SlackInboundMessage } from '@mwc/tools-core';
import { asc, eq } from 'drizzle-orm';
import { ended, turnRow } from './chats/world.ts';
import { rawUser, type SlackSceneOptions } from './integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  message,
  ok,
} from './integrations/slack-inbound.ts';
import type { MembersCompany } from './members/members.ts';

/** Erich's Slack person, and his avatar. */
export const ERICH = 'U0ERICH';
export const ERICH_AVATAR = 'https://avatars.slack-edge.com/erich_72.png';

/** Erich as `users.info` gives him, with `fields` over his profile. */
export const erichInfo = (profile: Record<string, unknown> = {}) =>
  ok({
    user: rawUser(ERICH, 'erich', {
      real_name: 'Erich Stuntebeck',
      profile: {
        display_name: 'Erich',
        title: 'Principal Engineer',
        email: 'erich@airia.test',
        image_72: ERICH_AVATAR,
        ...profile,
      },
    }),
  });

/** An inbound scene whose sign-in lists Erich (and Ihor), with DMs the agent may answer, Slack answering for Erich. */
export async function erichScene(w: InboundWorld, options: SlackSceneOptions = {}): Promise<InboundScene> {
  const s = await inboundScene(w, {
    rights: { dms: 'post' },
    ...options,
    settings: {
      people: [
        { id: 'U0IHOR', name: 'Ihor Herasko', image: null },
        { id: ERICH, name: 'Erich S.', image: 'https://avatars.slack-edge.com/erich_listed.png' },
      ],
    },
  });
  answerSlack(w, { 'users.info': erichInfo() });
  return s;
}

/** A DM of Erich's to the bot (`fields` over it). */
export const erichDm = (fields: Partial<SlackInboundMessage> = {}) =>
  message({
    type: 'message',
    channel: 'D0ERICH',
    channelType: 'im',
    user: ERICH,
    text: 'Can you check the deploy?',
    ...fields,
  });

/** Delivers a message, answers its turn with `reply` and waits until it ended; the turn's row. */
export async function wokenAndAnswered(
  s: InboundScene,
  w: InboundWorld,
  sent: SlackInboundMessage,
  reply = 'On it.',
) {
  await s.conn.deliver(sent);
  const runner = s.runner as FakeRunner;
  const start = await runner.frames.next('turn.start');
  answerTurn(runner, start, reply);
  await ended(w.t.db, start.turnId);
  return { start, turn: await turnRow(w.t.db, start.turnId) };
}

/** A company's contacts, oldest first. */
export const contactRows = (db: DbHandle, companyId: string) =>
  rawDb(db).select().from(contacts).where(eq(contacts.companyId, companyId)).orderBy(asc(contacts.createdAt));

/** `/api/companies/{companyId}/contacts[/rest]`. */
export const contactsPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/contacts${rest === '' ? '' : `/${rest}`}`;
