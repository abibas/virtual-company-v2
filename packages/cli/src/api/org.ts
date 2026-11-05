/**
 * The org chart and the agents of a company, as `GET /api/companies/:companyId/org/chart` and `.../agents` answer them
 * (S2.3), for `mwc org tree`, `mwc agents list` and `@mwc/mcp`; exported as `@mwc/cli/api/org`. The shapes mirror the
 * server's schemas (`apps/server/src/modules/org/schemas.ts`) without importing the server.
 */
import { AgentStatus } from '@mwc/shared/enums';
import { type ApiResult, apiGet, type Fetch, isObject } from './client.ts';

interface NodeBase {
  readonly principalId: string;
  readonly reportsTo: string | null;
  readonly title: string | null;
}

/** A person on the chart. */
export interface PersonNode extends NodeBase {
  readonly kind: 'person';
  readonly person: {
    readonly userId: string;
    readonly displayName: string;
    readonly email: string;
    readonly role: string;
  };
}

/** An agent on the chart. */
export interface AgentNode extends NodeBase {
  readonly kind: 'agent';
  readonly agent: {
    readonly agentId: string;
    readonly name: string;
    readonly slug: string;
    readonly roleTitle: string;
    readonly status: string;
    readonly face: number;
    readonly model: string;
    readonly effort: string;
  };
}

export type ChartNode = PersonNode | AgentNode;

/** A principal in the tree with its reports; `orphan` marks a top entry whose manager is not on the chart. */
export interface TreeEntry {
  readonly principalId: string;
  readonly kind: string;
  readonly orphan: boolean;
  readonly children: readonly TreeEntry[];
}

/** Every active member and every agent not archived, and the same principals as a tree. */
export interface OrgChart {
  readonly nodes: readonly ChartNode[];
  readonly tree: readonly TreeEntry[];
}

/** An agent as the list shows it (no instructions); `reportsTo` and `title` are its place on the chart. */
export interface Agent {
  readonly id: string;
  readonly principalId: string;
  readonly name: string;
  readonly slug: string;
  readonly roleTitle: string;
  readonly status: string;
  readonly harness: string;
  readonly model: string;
  readonly effort: string;
  readonly instructionsRev: number;
  readonly maxConcurrentRuns: number;
  readonly face: number;
  readonly reportsTo: string | null;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Which agents to list: one status, or `all`; the API's default is the active and paused ones. */
export const AGENT_FILTERS: readonly string[] = [...AgentStatus.options, 'all'];

const isNode = (node: unknown): node is ChartNode =>
  isObject(node) &&
  typeof node.principalId === 'string' &&
  ((node.kind === 'person' && isObject(node.person)) || (node.kind === 'agent' && isObject(node.agent)));

const isTreeEntry = (entry: unknown): entry is TreeEntry =>
  isObject(entry) &&
  typeof entry.principalId === 'string' &&
  Array.isArray(entry.children) &&
  entry.children.every(isTreeEntry);

const isChart = (body: unknown): body is OrgChart =>
  isObject(body) &&
  Array.isArray(body.nodes) &&
  body.nodes.every(isNode) &&
  Array.isArray(body.tree) &&
  body.tree.every(isTreeEntry);

const isAgentList = (body: unknown): body is { agents: Agent[] } =>
  isObject(body) &&
  Array.isArray(body.agents) &&
  body.agents.every((a) => isObject(a) && typeof a.id === 'string' && typeof a.name === 'string');

const companyPath = (companyId: string, rest: string) =>
  `/api/companies/${encodeURIComponent(companyId)}${rest}`;

/** `GET /api/companies/:companyId/org/chart`. */
export function getChart(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
): Promise<ApiResult<OrgChart>> {
  return apiGet(fetch, server, key, companyPath(companyId, '/org/chart'), isChart);
}

/** `GET /api/companies/:companyId/agents[?status=...]`: the agents, the active and paused ones unless `status` says. */
export async function listAgents(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
  status?: string,
): Promise<ApiResult<readonly Agent[]>> {
  const query = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
  const result = await apiGet(fetch, server, key, companyPath(companyId, `/agents${query}`), isAgentList);
  return result.ok ? { ok: true, body: result.body.agents } : result;
}
