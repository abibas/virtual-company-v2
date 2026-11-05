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
/** The access profile an agent uses, as agents show it: its name and owner, never its subscriptions. */
export type AgentProfile = NonNullable<Agent['profile']>;

/** The person's own subscriptions, sign-ins, limits and access profiles (`/api/me/...`, a Clerk session only). */
type SubscriptionRoutes = Api['api']['me']['subscriptions'];
type ProfileRoutes = Api['api']['me']['access-profiles'];

export type Subscription = InferResponseType<SubscriptionRoutes['$get'], 200>['subscriptions'][number];
export type SubscriptionKind = Subscription['kind'];
export type NewSubscription = InferRequestType<SubscriptionRoutes['$post']>['json'];
export type LimitsList = InferResponseType<SubscriptionRoutes['limits']['$get'], 200>;
export type SubscriptionLimits = LimitsList['limits'][number];
export type LimitWindow = SubscriptionLimits['windows'][number];
export type SignIn = InferResponseType<SubscriptionRoutes['sign-in'][':signInId']['$get'], 200>;
export type SignInProvider = SignIn['provider'];
export type AccessProfile = InferResponseType<ProfileRoutes['$get'], 200>['profiles'][number];
export type NewAccessProfile = InferRequestType<ProfileRoutes['$post']>['json'];
export type AccessProfileChanges = InferRequestType<ProfileRoutes[':profileId']['$patch']>['json'];
