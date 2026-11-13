/**
 * What a Slack post carries (S7.1e): its text with every mention of many people taken out (`@here`, `@channel`,
 * `@everyone` and user groups never ping anyone: the word stays, the mention goes), as plain text with no footer.
 * Pure.
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

/** The longest name a customized post shows (Slack cuts at 80). */
export const USERNAME_MAX = 80;

/** The agent's name as a post shows it. */
export const postName = (agent: string) => agent.replace(/\s+/g, ' ').trim().slice(0, USERNAME_MAX);
