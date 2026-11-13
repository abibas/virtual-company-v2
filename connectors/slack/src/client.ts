import { type SlackApi, SlackError } from '@mwc/tools-core';
import { type HttpOptions, slackHttp } from './http.ts';
import { channelOf, messageOf, obj, pageOf, searchOf, str, userOf } from './map.ts';

/**
 * The Slack connector (S7.1e): `@mwc/tools-core`'s `SlackApi` over Slack's Web API, through the injected `fetch` with its
 * retries and deadlines (`http.ts`). A post goes with `link_names` off, `parse` none and no unfurls, so its text never
 * becomes a mention it did not write as one. The server wires it in `app.ts` with its provider client, so tests pass a
 * fake and nothing reaches Slack.
 */
export function slackClient(options: HttpOptions): SlackApi {
  const call = slackHttp(options);
  return {
    async listConversations(signIn, query) {
      const body = await call(signIn, 'conversations.list', {
        types: query.types.join(','),
        limit: query.limit,
        cursor: query.cursor,
        exclude_archived: true,
      });
      return pageOf(body, 'channels', channelOf);
    },
    async conversationInfo(signIn, channel) {
      return channelOf(obj((await call(signIn, 'conversations.info', { channel })).channel));
    },
    async openDm(signIn, user) {
      const body = await call(signIn, 'conversations.open', { users: user, return_im: true });
      const id = str(obj(body.channel).id);
      if (id === null) throw new SlackError('invalid_response', { detail: 'Slack opened no DM.' });
      return id;
    },
    async history(signIn, channel, query) {
      const { limit, cursor, oldest, latest } = query;
      const body = await call(signIn, 'conversations.history', { channel, limit, cursor, oldest, latest });
      return pageOf(body, 'messages', messageOf);
    },
    async replies(signIn, channel, ts, query) {
      const body = await call(signIn, 'conversations.replies', { channel, ts, ...query });
      return pageOf(body, 'messages', messageOf);
    },
    async listUsers(signIn, query) {
      return pageOf(await call(signIn, 'users.list', { ...query }), 'members', userOf);
    },
    async userInfo(signIn, user) {
      return userOf(obj((await call(signIn, 'users.info', { user })).user));
    },
    async postMessage(signIn, post) {
      const body = await call(signIn, 'chat.postMessage', {
        channel: post.channel,
        text: post.text,
        thread_ts: post.threadTs,
        username: post.username,
        icon_emoji: post.iconEmoji,
        icon_url: post.iconUrl,
        link_names: false,
        parse: 'none',
        unfurl_links: false,
        unfurl_media: false,
      });
      return { channel: str(body.channel) ?? post.channel, ts: str(body.ts) ?? '' };
    },
    async addReaction(signIn, reaction) {
      await call(signIn, 'reactions.add', { ...reaction });
    },
    async searchMessages(signIn, query) {
      const { sort, sortDir, ...rest } = query;
      const body = await call(signIn, 'search.messages', {
        ...rest,
        sort,
        sort_dir: sortDir,
        highlight: false,
      });
      return searchOf(body);
    },
  };
}
