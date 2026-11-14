import { z } from '@hono/zod-openapi';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"): a chat's people as its header lists them, what a
 * chat's detail adds (its people, whether the reader only looks on as an owner, its Slack conversation), and the bodies
 * that add people and begin a chat with several.
 */

const dateTime = z.string().openapi({ format: 'date-time' });

/** One person in a chat. */
export const ChatPersonSchema = z
  .object({
    id: z
      .string()
      .openapi({ description: 'Their place in the chat (`DELETE …/people/{personId}` names it)' }),
    kind: z.enum(['member', 'contact']).openapi({
      description: 'A member of the company, or a contact from outside (a Slack conversation’s person)',
    }),
    principalId: z.string().nullable().openapi({ description: "A member's principal; null for a contact" }),
    contactId: z.string().nullable().openapi({ description: "A contact's id; null for a member" }),
    name: z.string(),
    imageUrl: z.string().nullable(),
    creator: z.boolean().openapi({ description: 'They began the chat' }),
    addedBy: z
      .string()
      .nullable()
      .openapi({ description: 'Who added them (a principal); null: Most Wanted' }),
    addedAt: dateTime,
  })
  .openapi('ChatPerson');

/** A chat's people. */
export const ChatPeopleSchema = z.object({ people: z.array(ChatPersonSchema) }).openapi('ChatPeople');

/** What a chat's detail says of its people. */
export const chatPeopleFields = {
  people: z.array(ChatPersonSchema).openapi({
    description:
      "Who is in the chat; empty for a task's conversation or a team chat, which keep their own rules",
  }),
  ownerView: z.boolean().openapi({
    description:
      'True when the reader is a company owner who is not in the chat: they read it only (Add me puts them in)',
  }),
  slack: z
    .object({
      place: z.string().openapi({ example: '#general', description: 'Where the conversation is, in words' }),
      link: z
        .string()
        .nullable()
        .openapi({ description: 'The conversation in Slack, when its address is known' }),
      mayPost: z.boolean().openapi({
        description:
          "True when the reader is the Slack connection's owner, who may send in Slack from here (`POST …/slack-messages`)",
      }),
    })
    .nullable()
    .openapi({ description: 'The Slack conversation the chat is for; null for any other chat' }),
};

const Principals = z
  .array(z.string().min(1))
  .min(1)
  .max(20)
  .openapi({ description: 'Members of the company (their principals), at most 20' });

/** Members to add to a chat (an owner who is not in it: only themselves, Add me). */
export const AddPeopleSchema = z.object({ principalIds: Principals }).openapi('AddChatPeople');

/** A new chat, with this chat's own access profile (only the caller's own) and the members it is with. */
export const CreateChatSchema = z
  .object({
    profileId: z.string().nullable().optional(),
    with: Principals.optional().openapi({
      description: 'The members the chat is with besides you (a chat with several people); none: just you',
    }),
  })
  .openapi('CreateChat');

export const PersonParamsSchema = z.object({
  companyId: z.string().openapi({ param: { name: 'companyId', in: 'path' } }),
  chatId: z.string().openapi({ param: { name: 'chatId', in: 'path' } }),
  personId: z.string().openapi({ param: { name: 'personId', in: 'path' } }),
});

export type ChatPersonView = z.infer<typeof ChatPersonSchema>;
export type CreateChat = z.infer<typeof CreateChatSchema>;
