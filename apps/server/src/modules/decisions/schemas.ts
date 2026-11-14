import { z } from '@hono/zod-openapi';
import { DecisionOutcome } from '@mwc/shared/enums';
import { DECISION_LIMITS } from '@mwc/shared/flows';

// The decision log's shapes (2026-11-14, docs/processes.md "Decisions"): a recorded decision as the API reads it, and
// the list's filters.

/** The most decisions one page lists, and how many by default. */
export const DECISION_PAGE = { default: 50, max: 200 } as const;

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });
const query = (name: string, example: string) => ({ param: { name, in: 'query' as const }, example });
const Id = z.uuid();

export const CompanyParamsSchema = z.object({
  companyId: pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10'),
});

/** `?agent&chat&task&contact&outcome&limit&before`: the company's decisions, newest first, a page at a time. */
export const DecisionListQuerySchema = z.object({
  /** An agent's id. */
  agent: Id.optional().openapi(query('agent', '019a4f0c-9d2f-7a3b-8c41-5e2f3a7b8c90')),
  /** A chat's id: the decisions made in its turns. */
  chat: Id.optional().openapi(query('chat', '019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f')),
  /** A task's id: the decisions made in its steps' turns. */
  task: Id.optional().openapi(query('task', '019a4f0c-b2c3-7d4e-8f50-6a7b8c9d0e1f')),
  /** A contact's id: the decisions made in conversations with them. */
  contact: Id.optional().openapi(query('contact', '019a4f0c-c3d4-7e5f-8061-7b8c9d0e1f20')),
  outcome: DecisionOutcome.optional().openapi(query('outcome', 'approved')),
  limit: z.coerce.number().int().min(1).max(DECISION_PAGE.max).optional().openapi(query('limit', '50')),
  /** The `nextBefore` of the page before: a decision's id, the page then starts after it. */
  before: Id.optional().openapi(query('before', '019a4f0c-d4e5-7f60-8172-8c9d0e1f2031')),
});

export const DecisionSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    chatId: z.string(),
    turnId: z.string(),
    taskId: z.string().nullable(),
    contactId: z.string().nullable(),
    what: z.string().max(DECISION_LIMITS.what),
    why: z.string().max(DECISION_LIMITS.why),
    sources: z.array(z.string()),
    outcome: DecisionOutcome.nullable(),
    eventSeq: z.int().nullable().openapi({ description: 'The turn’s last event when it was recorded' }),
    createdAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Decision');

export const DecisionListSchema = z
  .object({
    decisions: z.array(DecisionSchema),
    /** Pass it as `before` for the next page; null on the last one. */
    nextBefore: z.string().nullable(),
  })
  .openapi('DecisionList');

export type DecisionListQuery = z.infer<typeof DecisionListQuerySchema>;
export type DecisionList = z.infer<typeof DecisionListSchema>;
export type DecisionApiView = z.infer<typeof DecisionSchema>;
