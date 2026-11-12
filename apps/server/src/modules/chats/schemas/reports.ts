import { z } from '@hono/zod-openapi';
import { AgentStatus, ChatTurnStatus } from '@mwc/shared/enums';

/**
 * Your direct reports' chats with you (the right rail's Chats, docs/harness.md "Your direct reports in the rail"): each
 * agent that reports to you on the chart, its main chat with you and where that chat stands.
 */

const dateTime = z.string().openapi({ format: 'date-time' });

export const ReportChatsParamsSchema = z.object({
  companyId: z.string().openapi({
    param: { name: 'companyId', in: 'path' },
    example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  }),
});

const ReportAgentSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  name: z.string(),
  slug: z.string(),
  roleTitle: z.string(),
  status: AgentStatus,
});

const ReportTeamSchema = z.object({
  flowId: z.string(),
  name: z.string().openapi({ description: "The flow's name" }),
  chatId: z.string().nullable().openapi({
    description: "The flow's latest team chat with this Lead (not archived); null before its first wake-up",
  }),
});

export const ReportChatSchema = z.object({
  agent: ReportAgentSchema,
  team: ReportTeamSchema.nullable().openapi({
    description: 'The flow it leads (a Lead has one) with its team chat; null when it leads none',
  }),
  chat: z
    .object({ id: z.string(), title: z.string().nullable(), updatedAt: dateTime })
    .nullable()
    .openapi({
      description:
        'Its main chat with you: the latest you began with it (by its last message), not archived, neither a ' +
        "task's conversation nor a team chat; null for none (the first message begins one)",
    }),
  lastTurn: z
    .object({ status: ChatTurnStatus, at: dateTime })
    .nullable()
    .openapi({ description: "The main chat's last turn: its status and when it last changed" }),
  working: z.boolean().openapi({ description: 'A turn of the main chat is running' }),
  question: z.boolean().openapi({ description: "The main chat's last turn asks something nobody answered" }),
  replyAt: dateTime.nullable().openapi({
    description:
      "When the main chat's latest reply ended (its latest message turn that is done); null for none",
  }),
  messageAt: dateTime.nullable().openapi({
    description: 'When you last wrote in the main chat: a reply that ended before it was seen, by then',
  }),
});

export const ReportChatsSchema = z.object({
  reports: z.array(ReportChatSchema).openapi({ description: 'The Leads first, then by name' }),
});

export type ReportChatView = z.infer<typeof ReportChatSchema>;
