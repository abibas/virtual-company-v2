import { z } from '@hono/zod-openapi';
import { AgentStatus, Effort, Harness, MembershipRole, PrincipalKind } from '@mwc/shared/enums';
import {
  AGENT_DEFAULTS,
  AGENT_FACE,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_MAX_CONCURRENT_RUNS,
  AGENT_MODEL_MAX,
  AGENT_NAME,
  AGENT_ROLE_TITLE,
  POSITION_TITLE_MAX,
} from '@mwc/shared/org';
import { SLUG_PATTERN } from '@mwc/shared/slugs';

const pathParam = (name: string, example: string) =>
  z.string().openapi({ param: { name, in: 'path' }, example });

const companyId = pathParam('companyId', '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10');
const at = z.string().openapi({ format: 'date-time' });

export const AgentsParamsSchema = z.object({ companyId });
export const AgentParamsSchema = z.object({
  companyId,
  agentId: pathParam('agentId', '019a4f0c-c4d5-7e6f-8a7b-9c0d1e2f3a4b'),
});
export const PositionParamsSchema = z.object({
  companyId,
  principalId: pathParam('principalId', '019a4f0c-d5e6-7f80-9a1b-2c3d4e5f6a7b'),
});

/** Which agents to list: the active and paused ones by default, or those of one status, or `all`. */
export const AgentListQuerySchema = z.object({
  status: z
    .enum([...AgentStatus.options, 'all'])
    .optional()
    .openapi({ param: { name: 'status', in: 'query' }, example: 'archived' }),
});

const Name = z.string().trim().min(AGENT_NAME.min).max(AGENT_NAME.max).openapi({ example: 'SLOP BOX' });
const RoleTitle = z
  .string()
  .trim()
  .min(AGENT_ROLE_TITLE.min)
  .max(AGENT_ROLE_TITLE.max)
  .openapi({ example: 'Coder' });
const Slug = z
  .string()
  .regex(SLUG_PATTERN, 'lower-case letters, digits and dashes, 1 to 63 characters, no dash at either end')
  .openapi({ example: 'slop-box' });
const Model = z.string().trim().min(1).max(AGENT_MODEL_MAX).openapi({ example: AGENT_DEFAULTS.model });
const Instructions = z.string().max(AGENT_INSTRUCTIONS_MAX);
const MaxRuns = z.number().int().min(AGENT_MAX_CONCURRENT_RUNS.min).max(AGENT_MAX_CONCURRENT_RUNS.max);
const Face = z.number().int().min(AGENT_FACE.min).max(AGENT_FACE.max);
const PrincipalRef = z.string().openapi({ example: '019a4f0c-9d2f-7a3b-8c41-5e2f3a7b8c90' });
const Title = z.string().trim().max(POSITION_TITLE_MAX).nullable().openapi({ example: 'CTO' });

/** An agent as lists show it: everything but its instructions; `reportsTo` and `title` are its place on the chart. */
export const AgentSchema = z
  .object({
    id: z.string(),
    principalId: z.string(),
    name: z.string(),
    slug: z.string(),
    roleTitle: z.string(),
    status: AgentStatus,
    harness: Harness,
    model: z.string(),
    effort: Effort,
    instructionsRev: z.number().int(),
    maxConcurrentRuns: z.number().int(),
    face: z.number().int(),
    reportsTo: z.string().nullable().openapi({ description: 'Its manager’s principal; null once archived' }),
    title: z.string().nullable(),
    createdAt: at,
    updatedAt: at,
  })
  .openapi('Agent');

/** One agent with its standing instructions. */
export const AgentDetailSchema = AgentSchema.extend({ instructions: z.string() }).openapi('AgentDetail');

export const AgentListSchema = z.object({ agents: z.array(AgentSchema) }).openapi('AgentList');

/**
 * A new agent. Left out: the slug is derived from the name (with `-2`, `-3`, ... when taken), the face from the slug,
 * and the manager is the caller.
 */
export const CreateAgentSchema = z
  .object({
    name: Name,
    slug: Slug.optional(),
    roleTitle: RoleTitle,
    model: Model.default(AGENT_DEFAULTS.model),
    effort: Effort.default(AGENT_DEFAULTS.effort),
    harness: Harness.default(AGENT_DEFAULTS.harness),
    instructions: Instructions.default(AGENT_DEFAULTS.instructions),
    maxConcurrentRuns: MaxRuns.default(AGENT_DEFAULTS.maxConcurrentRuns),
    face: Face.optional(),
    reportsToPrincipalId: PrincipalRef.nullable().optional(),
  })
  .openapi('CreateAgent');

/** Any of the agent's fields; `status: archived` takes it off the chart, and back from there it reports to the caller. */
export const UpdateAgentSchema = z
  .object({
    name: Name.optional(),
    slug: Slug.optional(),
    roleTitle: RoleTitle.optional(),
    model: Model.optional(),
    effort: Effort.optional(),
    harness: Harness.optional(),
    instructions: Instructions.optional(),
    maxConcurrentRuns: MaxRuns.optional(),
    face: Face.optional(),
    status: AgentStatus.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one field to change')
  .openapi('UpdateAgent');

/** A move (`reportsToPrincipalId`, null for the top), a title (null or empty to clear it), or both. */
export const UpdatePositionSchema = z
  .object({ reportsToPrincipalId: PrincipalRef.nullable().optional(), title: Title.optional() })
  .refine(
    (body) => body.reportsToPrincipalId !== undefined || body.title !== undefined,
    'Give reportsToPrincipalId, title or both',
  )
  .openapi('UpdatePosition');

/** A place on the chart. */
export const PositionSchema = z
  .object({ principalId: z.string(), reportsTo: z.string().nullable(), title: z.string().nullable() })
  .openapi('Position');

const nodeBase = { principalId: z.string(), reportsTo: z.string().nullable(), title: z.string().nullable() };

/** A person on the chart, with what the chart shows of them. */
export const PersonNodeSchema = z
  .object({
    ...nodeBase,
    kind: z.literal('person'),
    person: z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.string(),
      role: MembershipRole,
    }),
  })
  .openapi('PersonNode');

/** An agent on the chart, with what the chart shows of it. */
export const AgentNodeSchema = z
  .object({
    ...nodeBase,
    kind: z.literal('agent'),
    agent: z.object({
      agentId: z.string(),
      name: z.string(),
      slug: z.string(),
      roleTitle: z.string(),
      status: AgentStatus,
      face: z.number().int(),
      model: z.string(),
      effort: Effort,
    }),
  })
  .openapi('AgentNode');

export const ChartNodeSchema = z.discriminatedUnion('kind', [PersonNodeSchema, AgentNodeSchema]);

/** A principal in the tree with its reports; `orphan` marks a top entry whose manager is not on the chart. */
export interface OrgTreeView {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly orphan: boolean;
  readonly children: OrgTreeView[];
}

export const OrgTreeNodeSchema: z.ZodType<OrgTreeView> = z
  .object({
    principalId: z.string(),
    kind: PrincipalKind,
    orphan: z.boolean(),
    get children() {
      return z.array(OrgTreeNodeSchema);
    },
  })
  .openapi('OrgTreeNode');

/** The chart: every active member and every agent not archived, and the same principals as a tree. */
export const OrgChartSchema = z
  .object({ nodes: z.array(ChartNodeSchema), tree: z.array(OrgTreeNodeSchema) })
  .openapi('OrgChart');

export type AgentView = z.infer<typeof AgentSchema>;
export type AgentDetailView = z.infer<typeof AgentDetailSchema>;
export type CreateAgent = z.infer<typeof CreateAgentSchema>;
export type UpdateAgent = z.infer<typeof UpdateAgentSchema>;
export type UpdatePosition = z.infer<typeof UpdatePositionSchema>;
export type PositionView = z.infer<typeof PositionSchema>;
export type ChartNodeView = z.infer<typeof ChartNodeSchema>;
export type OrgChartView = z.infer<typeof OrgChartSchema>;
export type AgentListFilter = z.infer<typeof AgentListQuerySchema>['status'];
