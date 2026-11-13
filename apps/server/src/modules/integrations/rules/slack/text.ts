/**
 * What a Slack post carries (S7.1e): its text with every mention of many people taken out (`@here`, `@channel`,
 * `@everyone` and user groups never ping anyone: the word stays, the mention goes), in sections, with a small footer
 * naming the agent ("via Most Wanted · QA"). Pure.
 */

/** Slack's special mentions as they travel (`<!here>`, `<!channel|@channel>`). */
const SPECIAL = /<!(here|channel|everyone)(?:\|[^>]*)?>/gi;
/** A user group's mention (`<!subteam^S0123|@devs>`). */
const GROUP = /<!subteam\^[A-Z0-9]+(?:\|@?([^>]*))?>/g;
/** The same typed as words, which Slack links when it parses names. */
const BARE = /(^|[^\w<@])@(here|channel|everyone)\b/gi;

/** A text without mentions of many people, and the ones taken out (`@here`, `@devs`). */
export function stripMentions(text: string): { readonly text: string; readonly stripped: string[] } {
  const stripped: string[] = [];
  const plain = text
    .replace(SPECIAL, (_, word: string) => {
      stripped.push(`@${word.toLowerCase()}`);
      return word;
    })
    .replace(GROUP, (_, label: string | undefined) => {
      const name = label?.trim() || 'group';
      stripped.push(`@${name}`);
      return name;
    })
    .replace(BARE, (_, before: string, word: string) => {
      stripped.push(`@${word.toLowerCase()}`);
      return `${before}${word}`;
    });
  return { text: plain, stripped: [...new Set(stripped)] };
}

/** The longest section Slack takes, in characters. */
export const SECTION_MAX = 3000;

/** A text in pieces of at most `SECTION_MAX`, each cut at its last line break when it has one. */
export function sections(text: string): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > SECTION_MAX) {
    const breakAt = rest.lastIndexOf('\n', SECTION_MAX);
    const at = breakAt > 0 ? breakAt : SECTION_MAX;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  return rest === '' ? pieces : [...pieces, rest];
}

/** The footer every post carries. */
export const footerText = (agent: string) => `via Most Wanted · ${agent.replace(/\s+/g, ' ').trim()}`;

/** A post's blocks: its text in sections, then the footer as a context line. */
export function postBlocks(text: string, agent: string): Record<string, unknown>[] {
  return [
    ...sections(text).map((piece) => ({ type: 'section', text: { type: 'mrkdwn', text: piece } })),
    { type: 'context', elements: [{ type: 'plain_text', text: footerText(agent), emoji: true }] },
  ];
}

/** The longest name a customized post shows (Slack cuts at 80). */
export const USERNAME_MAX = 80;

/** The agent's name as a post shows it. */
export const postName = (agent: string) => agent.replace(/\s+/g, ' ').trim().slice(0, USERNAME_MAX);
