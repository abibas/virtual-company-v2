import { z } from '@hono/zod-openapi';
import { FlowStepKind, StepOnReturn, StepStarts } from '@mwc/shared/enums';
import { FLOW_NAME, FLOW_STEPS_MAX, IN_PROGRESS_LIMIT, SEND_BACK_LIMIT, STEP_NAME } from '@mwc/shared/flows';
import { At, PrincipalRefSchema } from '../schemas.ts';

const FlowName = z
  .string()
  .trim()
  .min(FLOW_NAME.min)
  .max(FLOW_NAME.max)
  .openapi({ example: 'DEVBOX delivery' });
const StepName = z.string().trim().min(STEP_NAME.min).max(STEP_NAME.max).openapi({ example: 'Code review' });

/** One step of a flow's list as it is sent: the whole list replaces the flow's steps. */
export const StepInputSchema = z
  .object({
    /** The step it is, to keep its id (and the tasks at it) when the list is reordered; none for a new step. */
    id: z.uuid().optional(),
    name: StepName,
    kind: FlowStepKind,
    assigneePrincipalId: z.uuid(),
    /** `manual` unless said. */
    starts: StepStarts.optional(),
    /** `keep` unless said. */
    onReturn: StepOnReturn.optional(),
    /** An earlier step of this list, by name (Check and Sign-off only). */
    sendsBackTo: StepName.nullable().optional(),
    /** Send-backs before the Lead gets the task (Check and Sign-off only); null or none: no limit. */
    sendBackLimit: z.number().int().min(SEND_BACK_LIMIT.min).max(SEND_BACK_LIMIT.max).nullable().optional(),
  })
  .openapi('FlowStepInput');

/** The rules refuse more than `FLOW_STEPS_MAX` steps (422 `too_many_steps`); the schema only bounds the body. */
const StepList = z.array(StepInputSchema).max(FLOW_STEPS_MAX * 5);

export const CreateFlowSchema = z
  .object({ leadPrincipalId: z.uuid(), name: FlowName, steps: StepList })
  .openapi('CreateFlow');

const InProgressLimit = z.number().int().min(IN_PROGRESS_LIMIT.min).max(IN_PROGRESS_LIMIT.max);

/** A flow's name and its auto-take from Queued (T-25); what is left out stays as it is. */
export const PatchFlowSchema = z
  .object({
    name: FlowName.optional(),
    /** Take the next queued task into the first step by itself while fewer than the limit are in progress. */
    autoTake: z.boolean().optional(),
    /** At most this many of the flow's tasks in progress (active at any step) before auto-take waits. */
    inProgressLimit: InProgressLimit.optional(),
  })
  .openapi('PatchFlow');

export const PutStepsSchema = z.object({ steps: StepList }).openapi('PutFlowSteps');

/** A step as the flow shows it, with how many open tasks are at it. */
export const StepSchema = z
  .object({
    id: z.string(),
    position: z.number().int().min(1),
    name: z.string(),
    kind: FlowStepKind,
    assignee: PrincipalRefSchema,
    starts: StepStarts,
    onReturn: StepOnReturn,
    sendsBackToStepId: z.string().nullable(),
    /** The target's name. */
    sendsBackTo: z.string().nullable(),
    sendBackLimit: z.number().int().nullable(),
    /** Active and escalated tasks at this step. */
    openTasks: z.number().int().min(0),
  })
  .openapi('FlowStep');

export const FlowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lead: PrincipalRefSchema,
    steps: z.array(StepSchema),
    /** Auto-take from Queued (T-25) and its limit of tasks in progress. */
    autoTake: z.boolean(),
    inProgressLimit: z.number().int(),
    createdAt: At,
    updatedAt: At,
  })
  .openapi('Flow');

export const FlowSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lead: PrincipalRefSchema,
    stepCount: z.number().int().min(0),
    /** Queued, active and escalated tasks. */
    openTasks: z.number().int().min(0),
    createdAt: At,
    updatedAt: At,
  })
  .openapi('FlowSummary');

export const FlowListSchema = z.object({ flows: z.array(FlowSummarySchema) }).openapi('FlowList');

/** The flow's written form (docs/processes.md), the same text the web and `mwc flow show` print. */
export const FlowTextSchema = z
  .object({ text: z.string().openapi({ example: 'Flow: DEVBOX delivery · Lead: …' }) })
  .openapi('FlowText');

export type CreateFlow = z.infer<typeof CreateFlowSchema>;
export type PatchFlow = z.infer<typeof PatchFlowSchema>;
export type FlowView = z.infer<typeof FlowSchema>;
export type FlowSummaryView = z.infer<typeof FlowSummarySchema>;
export type StepView = z.infer<typeof StepSchema>;
