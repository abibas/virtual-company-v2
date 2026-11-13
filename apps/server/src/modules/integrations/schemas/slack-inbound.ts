import { z } from '@hono/zod-openapi';
import {
  SLACK_APP_TOKEN_PATTERN,
  SLACK_INBOUND_PER_HOUR,
  SLACK_PEOPLE_MAX,
  SLACK_USER_ID_PATTERN,
} from '@mwc/shared/credentials';
import { SlackInboundStatus, SlackWake } from '@mwc/shared/enums';

/**
 * Receiving Slack messages' API shapes (2026-11-13, `/api/me/subscriptions/{credentialId}/slack-inbound` and
 * `slack-people`): a bot sign-in's inbound settings as shown (never the app token: only whether it is set), a change to
 * them (the app token is write-only), and a search of the workspace's people.
 */

export const SlackSignInParamsSchema = z.object({
  credentialId: z.string().openapi({
    param: { name: 'credentialId', in: 'path' },
    example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b',
  }),
});

export const SlackPersonSchema = z
  .object({
    id: z.string().regex(SLACK_USER_ID_PATTERN).openapi({ example: 'U0123ABCD' }),
    name: z.string().trim().min(1).max(120).openapi({ example: 'Ihor Herasko' }),
    image: z
      .url({ protocol: /^https$/ })
      .max(500)
      .nullable(),
  })
  .openapi('SlackPerson');

const AgentRefSchema = z.object({ companyId: z.uuid(), agentId: z.uuid() });

export const SlackInboundSchema = z
  .object({
    credentialId: z.string(),
    appToken: z.boolean().openapi({ description: 'An app-level token is set (it is never shown)' }),
    inbound: z.boolean().openapi({ description: 'Receive messages: Socket Mode is kept open' }),
    wake: SlackWake,
    people: z.array(SlackPersonSchema),
    defaultAgent: AgentRefSchema.nullable(),
    maxPerHour: z.number().int(),
    lastHour: z.number().int().openapi({ description: 'The turns its messages started in the last hour' }),
    status: SlackInboundStatus,
    statusMessage: z.string().nullable(),
    statusAt: z.string().nullable().openapi({ format: 'date-time' }),
    receiving: z
      .boolean()
      .openapi({ description: 'This server keeps Socket Mode connections (its background work is on)' }),
    agents: z
      .array(
        z.object({
          companyId: z.string(),
          companyName: z.string(),
          companySlug: z.string(),
          agentId: z.string(),
          agentName: z.string(),
          agentSlug: z.string(),
        }),
      )
      .openapi({
        description: "The agents whose profile's Slack part uses this sign-in: the default agent's choices",
      }),
  })
  .openapi('SlackInbound');

export const SlackInboundChangeSchema = z
  .object({
    appToken: z
      .string()
      .trim()
      .regex(SLACK_APP_TOKEN_PATTERN, 'An app-level token starts with xapp-')
      .nullable()
      .optional()
      .openapi({ description: 'The app-level token (`xapp-`, scope connections:write); null removes it' }),
    inbound: z.boolean().optional(),
    wake: SlackWake.optional(),
    people: z
      .array(SlackPersonSchema)
      .max(SLACK_PEOPLE_MAX)
      .refine((people) => new Set(people.map((person) => person.id)).size === people.length, {
        message: 'Each person is listed once',
      })
      .optional(),
    defaultAgent: AgentRefSchema.nullable().optional(),
    maxPerHour: z.number().int().min(SLACK_INBOUND_PER_HOUR.min).max(SLACK_INBOUND_PER_HOUR.max).optional(),
  })
  .strict()
  .openapi('SlackInboundChange');

export const SlackPeopleQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).openapi({ description: 'A name, or an email', example: 'ihor' }),
});

export const SlackPeopleSchema = z.object({ people: z.array(SlackPersonSchema) }).openapi('SlackPeople');

export type SlackInboundView = z.infer<typeof SlackInboundSchema>;
export type SlackInboundChange = z.infer<typeof SlackInboundChangeSchema>;
