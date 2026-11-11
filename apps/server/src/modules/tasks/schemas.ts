import { z } from '@hono/zod-openapi';
import { FlowStepKind, PrincipalKind } from '@mwc/shared/enums';

// The tasks module's shapes (S5.3a): the path parameters and what flows, tasks and the board share. The flows' own are
// `schemas/flows.ts`, the tasks' `schemas/tasks.ts`, the board's `schemas/board.ts`.

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

const companyId = pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10');

export const CompanyParamsSchema = z.object({ companyId });
export const FlowParamsSchema = z.object({
  companyId,
  flowId: pathParam('flowId', '019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f'),
});
export const LeadParamsSchema = z.object({
  companyId,
  lead: pathParam('lead', 'devbox-coordinator').openapi({
    description: "The Lead's principal id, or an agent Lead's slug",
  }),
});
export const TaskParamsSchema = z.object({
  companyId,
  taskId: pathParam('taskId', 'T-12').openapi({ description: "The task's key (`T-12`) or id" }),
});

export const At = z.string().openapi({ format: 'date-time' });

/** A person or an agent as flows and tasks show them: a person's name (their email while they have none). */
export const PrincipalRefSchema = z
  .object({
    principalId: z.string(),
    kind: PrincipalKind,
    name: z.string().openapi({ example: 'DEVBOX Platform Coordinator' }),
    /** An agent's slug, for its page; null for a person. */
    slug: z.string().nullable(),
  })
  .openapi('PrincipalRef');

/** A step as a task names it. */
export const StepRefSchema = z
  .object({ id: z.string(), name: z.string().openapi({ example: 'Code review' }), kind: FlowStepKind })
  .openapi('StepRef');

export type PrincipalRef = z.infer<typeof PrincipalRefSchema>;
export type StepRef = z.infer<typeof StepRefSchema>;
