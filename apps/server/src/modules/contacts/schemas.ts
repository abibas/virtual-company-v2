import { z } from '@hono/zod-openapi';
import { CONTACT_NOTE_MAX } from '@mwc/shared/contacts';
import { ContactSource } from '@mwc/shared/enums';

/**
 * The contacts' shapes (2026-11-14, docs/subscriptions.md "Contacts"): a contact, the list, a contact's page (their
 * conversations with the company's agents and the counts per agent), the change admins make (the note, archived) and
 * the interactions the org chart draws (who talked to which agent lately, and who is being answered now).
 */

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });
const dateTime = z.string().openapi({ format: 'date-time' });
const COMPANY = pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10');

export const ContactsParamsSchema = z.object({ companyId: COMPANY });
export const ContactParamsSchema = z.object({
  companyId: COMPANY,
  contactId: pathParam('contactId', '019a8b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c'),
});

export const ContactsQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ description: '`true` lists the archived contacts too; left out, only the others' }),
});

export const InteractionsQuerySchema = z.object({
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .openapi({ description: 'From when to count (ISO 8601); left out: 7 days ago; at most 90 days back' }),
});

export const ContactSchema = z
  .object({
    id: z.string(),
    source: ContactSource,
    name: z.string(),
    avatarUrl: z.string().nullable(),
    email: z.string().nullable(),
    title: z.string().nullable(),
    handle: z
      .string()
      .nullable()
      .openapi({ description: "Their handle in the outside system (Slack's username)" }),
    slack: z
      .object({ teamId: z.string(), userId: z.string() })
      .nullable()
      .openapi({ description: 'The Slack workspace and person of a Slack contact' }),
    firstSeenAt: dateTime,
    lastSeenAt: dateTime,
    note: z.string().nullable(),
    archivedAt: dateTime.nullable(),
  })
  .openapi('Contact');

export const ContactListItemSchema = ContactSchema.extend({
  agentIds: z.array(z.string()).openapi({ description: 'The agents they talked to, the latest first' }),
  conversations: z.number().int().openapi({ description: 'How many chats they talked to agents in' }),
}).openapi('ContactListItem');

export const ContactListSchema = z
  .object({ contacts: z.array(ContactListItemSchema) })
  .openapi('ContactList');

const AgentRefSchema = z
  .object({ id: z.string(), principalId: z.string(), name: z.string(), slug: z.string() })
  .openapi('ContactAgent');

/** The last message of a conversation: the contact's, or the agent's reply. */
const LastMessageSchema = z
  .object({ by: z.enum(['contact', 'agent']), text: z.string(), at: dateTime })
  .openapi('ContactLastMessage');

export const ConversationSchema = z
  .object({
    chatId: z.string(),
    title: z.string().nullable(),
    place: z
      .string()
      .nullable()
      .openapi({ description: 'Where it is in Slack, in words (`#general`, `a DM`)' }),
    agent: AgentRefSchema,
    last: LastMessageSchema.nullable(),
    live: z.boolean().openapi({ description: 'A turn waits or runs there now' }),
    archived: z.boolean(),
    updatedAt: dateTime,
  })
  .openapi('ContactConversation');

export const AgentCountSchema = z
  .object({
    agent: AgentRefSchema,
    conversations: z.number().int(),
    messages: z.number().int().openapi({ description: 'Their messages that woke this agent' }),
    lastAt: dateTime,
  })
  .openapi('ContactAgentCount');

export const ContactDetailSchema = z
  .object({
    contact: ContactSchema,
    conversations: z.array(ConversationSchema).openapi({ description: 'The latest first, at most 200' }),
    agents: z
      .array(AgentCountSchema)
      .openapi({ description: 'Per agent, the one they talked to last first' }),
  })
  .openapi('ContactDetail');

export const ContactChangeSchema = z
  .object({
    note: z.string().max(CONTACT_NOTE_MAX).nullable().optional().openapi({
      description: 'The note; blank or null removes it',
    }),
    archived: z.boolean().optional(),
  })
  .refine((body) => body.note !== undefined || body.archived !== undefined, {
    message: 'Give a note or archived',
  })
  .openapi('ContactChange');

export const InteractionAgentSchema = z
  .object({
    agentId: z.string(),
    principalId: z.string(),
    messages: z.number().int().openapi({ description: 'Their messages that woke this agent since `since`' }),
    lastAt: dateTime,
    live: z.boolean().openapi({ description: 'A turn of theirs waits or runs at this agent now' }),
  })
  .openapi('ContactInteractionAgent');

export const InteractionsSchema = z
  .object({
    since: dateTime,
    contacts: z.array(
      z
        .object({
          contact: ContactSchema.pick({ id: true, name: true, avatarUrl: true, title: true }),
          live: z.boolean(),
          agents: z.array(InteractionAgentSchema),
        })
        .openapi('ContactInteraction'),
    ),
  })
  .openapi('ContactInteractions');

export type ContactView = z.infer<typeof ContactSchema>;
export type ContactListItemView = z.infer<typeof ContactListItemSchema>;
export type ConversationView = z.infer<typeof ConversationSchema>;
export type AgentCountView = z.infer<typeof AgentCountSchema>;
export type ContactDetailView = z.infer<typeof ContactDetailSchema>;
export type ContactChange = z.infer<typeof ContactChangeSchema>;
export type InteractionsView = z.infer<typeof InteractionsSchema>;
