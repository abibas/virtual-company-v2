import { z } from '@hono/zod-openapi';
import { TaskAction, TaskPriority } from '@mwc/shared/enums';
import { At, PrincipalRefSchema, StepRefSchema } from '../tasks/schemas.ts';

// The inbox's shapes (S6b, docs/processes.md "Built in S6b"): what needs the caller now, computed live from the tasks
// and the chats; no table of its own.

/**
 * What an item asks of the caller: a Sign-off at their step, another step of theirs (`step`), an escalated task of a team
 * they lead, a task blocked or whose turn ended without a hand-off, or an agent's open question.
 */
export const InboxKind = z.enum(['signoff', 'step', 'escalated', 'blocked', 'turn_ended', 'question']);
export type InboxKind = z.infer<typeof InboxKind>;

/** What the caller may do from the item: the task's moves (`POST …/tasks/{taskId}/actions`), or answer the question. */
export const InboxAction = z.enum([...TaskAction.options, 'answer']);
export type InboxAction = z.infer<typeof InboxAction>;

const CompanyRefSchema = z
  .object({ id: z.string(), slug: z.string(), name: z.string() })
  .openapi('InboxCompany');

/** The task an item is about. */
const InboxTaskSchema = z
  .object({
    id: z.string(),
    key: z.string().openapi({ example: 'T-12' }),
    title: z.string(),
    priority: TaskPriority,
    flow: z.object({ id: z.string(), name: z.string(), lead: PrincipalRefSchema }),
    /** Its step (the step it escalated from while escalated). */
    step: StepRefSchema.nullable(),
    /** Its entries into that step; null while escalated. */
    round: z.number().int().nullable(),
  })
  .openapi('InboxTask');

/** The question an item is about: the chat's open one (docs/harness.md "Asking the person"). */
const InboxQuestionSchema = z
  .object({
    chatId: z.string(),
    agentId: z.string(),
    questionId: z.string(),
    /** How many questions it asks at once (1–4); `title` is the first. */
    count: z.number().int(),
    /** The chat's title; a task's conversation is titled `T-12 · Develop · Fix the login`. */
    chatTitle: z.string().nullable(),
    /** The task whose conversation asks, if it is one. */
    taskKey: z.string().nullable(),
  })
  .openapi('InboxQuestion');

export const InboxItemSchema = z
  .object({
    /** `task:<taskId>` or `question:<questionId>`, stable while it waits. */
    id: z.string(),
    kind: InboxKind,
    company: CompanyRefSchema,
    /** The task's title, or the agent's (first) question. */
    title: z.string(),
    /** The flow and the step (`DEVBOX delivery · Approve`), or the agent and its chat. */
    subtitle: z.string(),
    /** Why it is blocked or escalated; null otherwise. */
    reason: z.string().nullable(),
    /** Who handed it on, sent it back, escalated it, reported the block or asked; null when nobody did. */
    from: PrincipalRefSchema.nullable(),
    /** Where it opens, inside the company (`/<slug>/<link>`): `tasks/T-12`, or `chats/<agentId>?chat=<chatId>`. */
    link: z.string(),
    /** What the caller may do now: the task's moves the API allows them, or `answer`. */
    actions: z.array(InboxAction),
    task: InboxTaskSchema.nullable(),
    question: InboxQuestionSchema.nullable(),
    /** Since when it waits. */
    at: At,
  })
  .openapi('InboxItem');

export const CompanyInboxSchema = z
  .object({ items: z.array(InboxItemSchema), count: z.number().int() })
  .openapi('CompanyInbox');

const CompanyCountSchema = CompanyRefSchema.extend({ count: z.number().int() }).openapi('InboxCompanyCount');

export const MyInboxSchema = z
  .object({
    items: z.array(InboxItemSchema),
    count: z.number().int(),
    /** Each company of the caller's, by name, with how many of the items are in it. */
    companies: z.array(CompanyCountSchema),
  })
  .openapi('MyInbox');

export const InboxCountSchema = z.object({ count: z.number().int() }).openapi('InboxCount');
export const MyInboxCountSchema = z
  .object({ count: z.number().int(), companies: z.array(CompanyCountSchema) })
  .openapi('MyInboxCount');

export type InboxItem = z.infer<typeof InboxItemSchema>;
export type InboxCompany = z.infer<typeof CompanyRefSchema>;
export type MyInbox = z.infer<typeof MyInboxSchema>;
