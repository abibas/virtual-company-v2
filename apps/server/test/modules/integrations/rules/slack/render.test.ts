import { describe, expect, it } from 'vitest';
import {
  channelView,
  hitView,
  MESSAGE_MAX,
  messageView,
  tsTime,
  userName,
  userView,
} from '../../../../../src/modules/integrations/rules/slack/render.ts';

const channel = {
  id: 'C1',
  name: 'eng',
  isPrivate: true,
  isIm: false,
  isMpim: false,
  isArchived: false,
  isMember: false,
  user: null,
  topic: null,
  purpose: 'Building',
  members: 4,
};
const message = {
  ts: '1731490000.000100',
  user: 'U1',
  botId: null,
  username: null,
  text: 'x'.repeat(MESSAGE_MAX + 1),
  subtype: null,
  threadTs: '1731480000.000100',
  replyCount: 0,
  reactions: [],
  files: ['a.png'],
};

describe('the Slack answers', () => {
  it('show a conversation: a private channel, a DM, a group DM', () => {
    expect(channelView(channel)).toEqual({
      id: 'C1',
      name: '#eng',
      private: true,
      member: false,
      purpose: 'Building',
      members: 4,
    });
    expect(channelView({ ...channel, name: null, isIm: true, user: 'U2', members: null })).toMatchObject({
      dm: 'direct',
      user: 'U2',
    });
    expect(channelView({ ...channel, isMpim: true })).toMatchObject({ dm: 'group' });
    expect(channelView({ ...channel, isMpim: true })).not.toHaveProperty('private');
  });

  it('show a message in a thread, cut when long, by its author’s id without a name', () => {
    const view = messageView(message, new Map());
    expect(view).toMatchObject({ user: 'U1', thread_ts: '1731480000.000100', files: ['a.png'] });
    expect(view.text).toContain('[cut: 1 more characters]');
    expect(messageView({ ...message, user: null, username: 'CI', botId: 'B1' }, new Map())).toMatchObject({
      user: 'CI',
      bot: 'CI',
    });
    expect(messageView({ ...message, user: null, botId: 'B1' }, new Map()).bot).toBe('B1');
    expect(tsTime('x')).toBeNull();
    expect(tsTime('0')).toBeNull();
  });

  it('show a person and a search hit', () => {
    const user = {
      id: 'U1',
      name: 'ihor',
      realName: null,
      displayName: null,
      title: null,
      isBot: false,
      deleted: true,
      timeZone: null,
      image: null,
    };
    expect(userView(user)).toEqual({ id: 'U1', name: 'ihor', deleted: true });
    expect(userName(user)).toBe('ihor');
    expect(userName({ ...user, realName: 'Ihor H' })).toBe('Ihor H');
    const hit = {
      channel: { id: 'D1', name: null, isIm: true, isMpim: false, isPrivate: false },
      ts: '1.0',
      user: 'U1',
      username: null,
      text: 'hi',
      permalink: null,
    };
    expect(hitView(hit)).toEqual({
      channel_id: 'D1',
      ts: '1.0',
      at: '1970-01-01T00:00:01.000Z',
      user: 'U1',
      text: 'hi',
    });
  });
});
