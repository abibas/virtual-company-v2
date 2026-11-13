import { z } from '@hono/zod-openapi';

/** A turn's sender (2026-11-13, `rules/sender.ts`): whom a turn Most Wanted queued for a message from outside speaks for. */
export const turnSenderFields = {
  from: z
    .object({ name: z.string(), via: z.enum(['slack']) })
    .nullable()
    .openapi({
      description:
        'Whom a turn Most Wanted queued for a message from outside speaks for (2026-11-13: a Slack message, by its ' +
        "sender's name, `via` `slack`); null for any other turn",
    }),
};
