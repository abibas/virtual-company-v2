/**
 * A Slack message's text as an agent reads it (2026-11-13): Slack's markup (`<@U…>`, `<#C…|name>`, `<!here>`,
 * `<https://…|label>`) rendered as names and links, and its entities decoded; and which agent it addresses first
 * (`@Bot @Developer …`). Pure.
 */

/** The people a text mentions by id only (`<@U…>` with no label), each once. */
export function mentionedIds(text: string): string[] {
  const ids = [...text.matchAll(/<@([UW][A-Z0-9]+)>/g)].map((match) => match[1] as string);
  return [...new Set(ids)];
}

const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** One `<…>` of Slack's markup as words. */
function rendered(inner: string, names: ReadonlyMap<string, string>): string {
  const [target = '', label] = inner.split('|', 2) as [string, string | undefined];
  if (target.startsWith('@')) return `@${label ?? names.get(target.slice(1)) ?? target.slice(1)}`;
  if (target.startsWith('#')) return `#${label ?? target.slice(1)}`;
  if (target.startsWith('!subteam^')) return label ?? '@group';
  if (target.startsWith('!date^')) return label ?? '';
  if (target.startsWith('!')) return `@${target.slice(1)}`;
  if (target.startsWith('mailto:')) return label ?? target.slice('mailto:'.length);
  return label === undefined || label === target ? target : `${label} (${target})`;
}

/** The text with Slack's markup rendered (names from `names`, by user id) and its entities decoded. */
export function renderSlackText(text: string, names: ReadonlyMap<string, string>): string {
  return decode(text.replace(/<([^<>]+)>/g, (_, inner: string) => rendered(inner, names)));
}

/** The text after the bot's first mention (`<@U0BOT> @Developer hi` → `@Developer hi`); the whole text without one. */
export function afterBotMention(text: string, botUserId: string | null): string {
  if (botUserId === null) return text.trim();
  const mention = new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`);
  const found = mention.exec(text);
  return (found === null ? text : text.slice(found.index + found[0].length)).trim();
}

/** A name ends there: the text's end, a space or punctuation. */
const endsAt = (rest: string, length: number) =>
  rest.length === length || /[\s,.:;!?)]/.test(rest[length] as string);

/**
 * The agent a message addresses with `@Name` right after the bot's mention (or at its start, in a DM), by its name or
 * its slug, any case, the longest that fits; undefined when it names none.
 */
export function addressedAgent<A extends { readonly name: string; readonly slug: string }>(
  text: string,
  botUserId: string | null,
  agents: readonly A[],
): A | undefined {
  const rest = afterBotMention(text, botUserId);
  if (!rest.startsWith('@')) return undefined;
  const named = rest.slice(1).toLowerCase();
  const names = agents.flatMap((agent) => [agent.name, agent.slug].map((name) => ({ agent, name })));
  names.sort((a, b) => b.name.length - a.name.length);
  return names.find(
    ({ name }) => name !== '' && named.startsWith(name.toLowerCase()) && endsAt(named, name.length),
  )?.agent;
}

/** What the message asks, for a chat's title: after the bot's mention and an agent's address. */
export function askedText(text: string, botUserId: string | null, agentName: string | null): string {
  let rest = afterBotMention(text, botUserId);
  if (agentName !== null && rest.toLowerCase().startsWith(`@${agentName.toLowerCase()}`))
    rest = rest.slice(agentName.length + 1);
  return rest.trim();
}
