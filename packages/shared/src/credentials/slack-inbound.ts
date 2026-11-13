import { z } from 'zod';

/**
 * A Slack connection's inbound settings (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): the app-level
 * token Socket Mode opens with (`xapp-`, sealed with the bot sign-in), the people who may wake agents when only listed
 * ones may, and the hourly cap on the turns its messages start. The limits the API's schemas and the CHECKs of
 * `slack_connections` (`@mwc/db`) both read. Pure.
 */

/** How an app-level token starts. */
export const SLACK_APP_TOKEN_PREFIX = 'xapp-';

/** An app-level token as pasted: `xapp-`, then letters, digits and dashes. */
export const SLACK_APP_TOKEN_PATTERN = /^xapp-[A-Za-z0-9-]{10,500}$/;

/** True for something shaped like an app-level token. */
export const isSlackAppToken = (token: string): boolean => SLACK_APP_TOKEN_PATTERN.test(token.trim());

/** The turns a connection's messages may start in an hour: 1 to 500, 30 unless set. */
export const SLACK_INBOUND_PER_HOUR = { min: 1, max: 500, default: 30 } as const;

/** The most people a connection lists as allowed to wake its agents. */
export const SLACK_PEOPLE_MAX = 50;

/** A Slack person's id: `U…` (or `W…` on Enterprise Grid). */
export const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,20}$/;

/** A person listed as allowed to wake agents: their Slack id, their name and avatar as Slack showed them. */
export const SlackPerson = z.object({
  id: z.string().regex(SLACK_USER_ID_PATTERN),
  name: z.string().trim().min(1).max(120),
  image: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable(),
});
export type SlackPerson = z.infer<typeof SlackPerson>;

/** The listed people, at most `SLACK_PEOPLE_MAX`, each once. */
export const SlackPeople = z
  .array(SlackPerson)
  .max(SLACK_PEOPLE_MAX)
  .refine((people) => new Set(people.map((person) => person.id)).size === people.length, {
    message: 'Each person is listed once',
  });

/** The stored list read back: the people that still parse, any other entry left out. */
export function storedPeople(value: unknown): SlackPerson[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const person = SlackPerson.safeParse(item);
    return person.success ? [person.data] : [];
  });
}
