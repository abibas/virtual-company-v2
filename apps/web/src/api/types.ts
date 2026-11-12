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
export type AgentBriefing = InferResponseType<AgentRoutes[':agentId']['briefing']['$get'], 200>;
/** `?status=` of the agent list: one status, or `all`. */
export type AgentFilter = NonNullable<InferRequestType<AgentRoutes['$get']>['query']['status']>;
export type NewAgent = InferRequestType<AgentRoutes['$post']>['json'];
export type AgentChanges = InferRequestType<AgentRoutes[':agentId']['$patch']>['json'];
/** An agent's icon as agents and the chart show it: its face, an emoji, or its image by its version. */
export type AgentIconView = Agent['icon'];
/** `PATCH /agents/:agentId/icon`: the face, or one emoji. */
export type AgentIconChoice = InferRequestType<AgentRoutes[':agentId']['icon']['$patch']>['json'];
export type PositionChange = InferRequestType<
  CompanyRoutes['org']['positions'][':principalId']['$put']
>['json'];
export type OrgChart = InferResponseType<CompanyRoutes['org']['chart']['$get'], 200>;
export type ChartNode = OrgChart['nodes'][number];
export type OrgTreeNode = OrgChart['tree'][number];
/** The access profile an agent uses, as agents show it: its name and owner, never its subscriptions. */
export type AgentProfile = NonNullable<Agent['profile']>;
/** Where an agent runs, as agents and the chart show it: its machine and mode (S4.7). */
export type AgentPlacementSummary = NonNullable<Agent['placement']>;
type PlacementRoutes = AgentRoutes[':agentId']['placement'];
/** `GET /agents/:agentId/placement`: its default placement with its machine's name and status, or null. */
export type AgentPlacement = InferResponseType<PlacementRoutes['$get'], 200>['placement'];
export type PlacementChange = InferRequestType<PlacementRoutes['$put']>['json'];
export type PlacementMode = PlacementChange['mode'];
export type PermissionPolicy = PlacementChange['permissionPolicy'];
/** A machine as the placement's machine select lists it (`GET /machines`). */
export type MachineChoice = InferResponseType<CompanyRoutes['machines']['$get'], 200>['machines'][number];

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
/** `POST /api/me/subscriptions/tools`: a pasted GitHub token, or an Atlassian site, email and API token. */
export type NewToolSignIn = InferRequestType<SubscriptionRoutes['tools']['$post']>['json'];
export type AccessProfile = InferResponseType<ProfileRoutes['$get'], 200>['profiles'][number];
export type NewAccessProfile = InferRequestType<ProfileRoutes['$post']>['json'];
export type AccessProfileChanges = InferRequestType<ProfileRoutes[':profileId']['$patch']>['json'];

/** The company's machines, their home-board stats, power and log (`/api/companies/:companyId/machines/...`). */
type MachineRoutes = CompanyRoutes['machines'];
type OneMachineRoutes = MachineRoutes[':machineId'];

export type MachineList = InferResponseType<MachineRoutes['$get'], 200>;
export type Machine = MachineList['machines'][number];
/** The runner the server hands out, or null while it is not built. */
export type LatestRunner = MachineList['latestRunner'];
export type MachineKind = Machine['kind'];
export type MachineChanges = InferRequestType<OneMachineRoutes['$patch']>['json'];
export type MachineStatsList = InferResponseType<MachineRoutes['stats']['$get'], 200>;
export type MachineStats = MachineStatsList['machines'][number];
export type UpDownSegment = MachineStats['upDown']['h24'][number];
export type EnrollmentToken = InferResponseType<MachineRoutes['enrollment-tokens']['$post'], 201>;
export type MachinePower = InferResponseType<OneMachineRoutes['power']['$get'], 200>;
export type PowerPolicy = MachinePower['policy'];
export type PowerBox = NonNullable<MachinePower['box']>;
export type ContainerPower = NonNullable<MachinePower['container']>;
export type PowerEvent = InferResponseType<OneMachineRoutes['events']['$get'], 200>['events'][number];
/** The CLIs a machine's runner found (null while offline or from a runner older than the tools), and the pins. */
export type MachineTools = NonNullable<Machine['runner']['tools']>;
export type ToolsLatest = Machine['runner']['toolsLatest'];
/** The maintenance job holding a machine (an install or a runner update), and its live work. */
export type MachineJob = NonNullable<Machine['runner']['job']>;
export type MachineLive = Machine['runner']['live'];
export type InstallableTool = Exclude<keyof ToolsLatest, 'source' | 'checkedAt'>;
export type ToolInstall = InferResponseType<OneMachineRoutes['tools']['install'][':installId']['$get'], 200>;

/** Chats with an agent on its machine (S5.1b), their turns and events (`/api/companies/:companyId/.../chats`). */
type ChatRoutes = CompanyRoutes['chats'][':chatId'];

export type Chat = InferResponseType<AgentRoutes[':agentId']['chats']['$get'], 200>['chats'][number];
export type ChatDetail = InferResponseType<ChatRoutes['$get'], 200>;
export type ChatTurnWithEvents = ChatDetail['turns'][number];
/** What a chat's detail leaves out: older turns of its current conversation, the conversations before each Clear. */
export type ChatEarlier = ChatDetail['earlier'];
export type ChatConversation = ChatEarlier['conversations'][number];
export type ChatTurn = InferResponseType<ChatRoutes['turns']['$post'], 202>;
export type ChatEvent = ChatTurnWithEvents['events'][number];
export type TurnEvent = ChatEvent['event'];
export type ChatChanges = InferRequestType<ChatRoutes['$patch']>['json'];
/** S5.2 step 6: how a message sent while the agent works reaches it (`now`, `after`, `interrupt`). */
export type ChatDelivery = NonNullable<InferRequestType<ChatRoutes['turns']['$post']>['json']['delivery']>;
/** An `event:` message of a chat's stream: one event with its turn's id and number (its `id:` is `<turnSeq>.<seq>`). */
export type ChatStreamEvent = ChatEvent & { readonly turnId: string; readonly turnSeq: number };
/** S5.2 step 4: the agent's questions, as its `question` event holds them, and the person's answers to them. */
export type QuestionEvent = Extract<TurnEvent, { type: 'question' }>;
export type AnsweredEvent = Extract<TurnEvent, { type: 'answered' }>;
export type AskQuestion = QuestionEvent['questions'][number];
export type AnswerBody = InferRequestType<ChatRoutes['answers']['$post']>['json'];
export type QuestionAnswer = AnswerBody['answers'][number];

/** A folder of a machine and the folders in it, as its runner read them (S5.1d). */
export type FolderList = InferResponseType<OneMachineRoutes['folders']['$get'], 200>;
export type FolderEntry = FolderList['entries'][number];
