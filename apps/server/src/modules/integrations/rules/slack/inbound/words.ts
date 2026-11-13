import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';

/**
 * The words of receiving Slack messages (2026-11-13): where a message is, a chat's title, the prompt's header line, the
 * message's link, the short notices posted back in Slack, and an agent's answer as posted. Pure.
 */

/** Where a message is, as the inbound rules read it: a channel's name, a DM, a group DM. */
export interface Place {
  readonly id: string;
  /** A channel's name; null for a DM or a group DM. */
  readonly name: string | null;
  /** A DM with the bot, or a group DM: the `dms` right applies, not the channels. */
  readonly dm: boolean;
}

/** A place in words: `#general`, `a DM`, `a group DM`. */
export const placeWords = (place: Place) =>
  place.name !== null ? `#${place.name}` : place.id.startsWith('D') ? 'a DM' : 'a group DM';

/** Where an agent may not post, in a notice: `#general`, or `direct messages`. */
const postWhere = (place: Place) => (place.dm ? 'direct messages' : placeWords(place));

/** A text on one line, cut to `max` with an ellipsis. */
export function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** A Slack conversation's chat title: "Slack · #general · <first words>", "Slack · DM · <first words>". */
export function slackChatTitle(place: Place, asked: string): string {
  const where = place.name !== null ? `#${place.name}` : place.id.startsWith('D') ? 'DM' : 'group DM';
  const head = `Slack · ${where}`;
  const words = oneLine(asked, CHAT_TITLE.max);
  return words === '' ? oneLine(head, CHAT_TITLE.max) : oneLine(`${head} · ${words}`, CHAT_TITLE.max);
}

/** A message's link: `<workspace>/archives/<channel>/p<ts without the dot>`, with its thread when it is a reply. */
export function messageLink(
  url: string | null,
  message: { readonly channel: string; readonly ts: string; readonly threadTs: string | null },
): string | null {
  if (url === null) return null;
  const base = `${url.replace(/\/+$/, '')}/archives/${message.channel}/p${message.ts.replace('.', '')}`;
  const { threadTs } = message;
  return threadTs === null || threadTs === message.ts
    ? base
    : `${base}?thread_ts=${threadTs}&cid=${message.channel}`;
}

/** The prompt: one header line (who wrote, where, the link, where the answer goes), then the message as rendered. */
export function inboundPrompt(message: {
  readonly from: string;
  readonly place: Place;
  readonly link: string | null;
  readonly threaded: boolean;
  readonly text: string;
}): string {
  const where =
    message.place.dm && message.place.id.startsWith('D') ? 'a DM with you' : placeWords(message.place);
  const link = message.link === null ? '' : ` (${message.link})`;
  const goes = message.threaded ? 'in that thread' : 'there';
  const header = `Slack message from ${oneLine(message.from, 120)} in ${where}${link}. Your final reply is posted ${goes} under your name.`;
  const room = CHAT_PROMPT.max - header.length - 2;
  const body = message.text.length <= room ? message.text : `${message.text.slice(0, room - 1)}…`;
  return `${header}\n\n${body === '' ? '(no text)' : body}`;
}

/** An agent whose profile may not answer there. */
export const notAllowedWords = (agent: string, place: Place) =>
  `${agent} isn't allowed to post in ${postWhere(place)}.`;

/** No agent to answer a fresh mention or a DM. */
export const NO_DEFAULT_AGENT =
  'No agent answers here yet: choose a default agent on this Slack sign-in’s card in Most Wanted (Subscriptions → Tools).';

/** Over the hourly cap: said once, then silence until the hour is over. */
export const capWords = (max: number) =>
  `This Slack connection is at its ${max} answers an hour: agents answer here again within the hour.`;

/** A turn that could not answer, in short. */
export const couldNotAnswer = (reason: string | null) =>
  `Couldn't answer: ${oneLine(reason === null || reason.trim() === '' ? 'the turn failed' : reason, 200)}`;

/** The longest answer posted: under Slack's 40 000 characters. */
export const ANSWER_POST_MAX = 39_000;

/** An agent's answer as posted: its text, cut to fit. */
export const answerText = (text: string) =>
  text.length <= ANSWER_POST_MAX ? text : `${text.slice(0, ANSWER_POST_MAX - 1)}…`;
