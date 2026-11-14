import { z } from '@hono/zod-openapi';

/**
 * A turn's sender (2026-11-13, `rules/sender.ts`): whom a turn Most Wanted queued for a message from outside speaks for,
 * and since 2026-11-14 (docs/subscriptions.md "Contacts") their Slack id, avatar, contact and the message's link, the
 * message as the reader sees it, and where the reply was posted back.
 */
export const turnSenderFields = {
  from: z
    .object({
      name: z.string(),
      via: z.enum(['slack']),
      userId: z
        .string()
        .nullable()
        .openapi({ description: 'Their Slack id; null for a turn from before 2026-11-14' }),
      avatarUrl: z.string().nullable(),
      link: z.string().nullable().openapi({ description: 'The message in Slack' }),
      contactId: z
        .string()
        .nullable()
        .openapi({
          description: 'Their contact (`GET …/contacts/{contactId}`); null for a turn from before contacts',
        }),
    })
    .nullable()
    .openapi({
      description:
        'Whom a turn Most Wanted queued for a message from outside speaks for (a Slack message: its sender, `via` ' +
        '`slack`); null for any other turn',
    }),
  visibleText: z
    .string()
    .nullable()
    .openapi({
      description:
        "A message from outside as the reader sees it, without the prompt's header (the agent still gets the whole " +
        'prompt); null: the prompt is what shows',
    }),
  replyLink: z.string().nullable().openapi({
    description: "Where the turn's reply was posted outside (the answer's message in Slack); null for none",
  }),
};
