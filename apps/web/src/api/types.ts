import type { InferRequestType, InferResponseType } from 'hono/client';
import type { Api } from './client.ts';

/** The response shapes the pages use, inferred from the server's routes (nothing is restated by hand). */
type CompanyRoutes = Api['api']['companies'][':companyId'];

export type PublicConfig = InferResponseType<Api['api']['config']['$get'], 200>;
export type Me = InferResponseType<Api['api']['me']['$get'], 200>;
export type Membership = Me['memberships'][number];
export type Company = InferResponseType<CompanyRoutes['$get'], 200>;
export type Member = InferResponseType<CompanyRoutes['members']['$get'], 200>['members'][number];
export type Invitation = InferResponseType<CompanyRoutes['invitations']['$get'], 200>['invitations'][number];
export type ApiKey = InferResponseType<CompanyRoutes['api-keys']['$get'], 200>['apiKeys'][number];
export type CreatedApiKey = InferResponseType<CompanyRoutes['api-keys']['$post'], 201>;
export type CompanySync = InferResponseType<CompanyRoutes['sync']['$post'], 200>;

type AgentRoutes = CompanyRoutes['agents'];
/** `GET /agents`: the agents, oldest first, without their instructions. */
export type AgentList = InferResponseType<AgentRoutes['$get'], 200>;
export type Agent = AgentList['agents'][number];
export type AgentDetail = InferResponseType<AgentRoutes[':agentId']['$get'], 200>;
/** `?status=` of the agent list: one status, or `all`. */
export type AgentFilter = NonNullable<InferRequestType<AgentRoutes['$get']>['query']['status']>;
export type NewAgent = InferRequestType<AgentRoutes['$post']>['json'];
export type AgentChanges = InferRequestType<AgentRoutes[':agentId']['$patch']>['json'];
export type PositionChange = InferRequestType<
  CompanyRoutes['org']['positions'][':principalId']['$put']
>['json'];
export type OrgChart = InferResponseType<CompanyRoutes['org']['chart']['$get'], 200>;
export type ChartNode = OrgChart['nodes'][number];
export type OrgTreeNode = OrgChart['tree'][number];
