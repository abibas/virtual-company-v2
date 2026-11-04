import type { InferResponseType } from 'hono/client';
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
