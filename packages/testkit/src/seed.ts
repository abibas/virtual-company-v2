import { randomBytes } from 'node:crypto';
import {
  type Agent,
  agents,
  type Company,
  companies,
  type DbHandle,
  type Membership,
  memberships,
  type NewAgent,
  orgPositions,
  type Principal,
  principals,
  type TenantDb,
  tenant,
  type User,
  userIdentities,
  users,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { FAKE_ISSUER } from '@mwc/identity-core/fake';
import type { CompanyStatus } from '@mwc/shared/enums';
import { AGENT_DEFAULTS } from '@mwc/shared/org';

export interface SeedCompanyOptions {
  readonly slug?: string;
  readonly name?: string;
  readonly status?: CompanyStatus;
  /** The provider organization; none by default (a company still provisioning has none either). */
  readonly identityOrgId?: string | null;
  /** The owner: a new person with an identity at `issuer` (default the fake provider's) as `subject`. */
  readonly owner?: {
    readonly email?: string;
    readonly displayName?: string;
    readonly provider?: string;
    readonly issuer?: string;
    readonly subject?: string;
  };
}

export interface SeededCompany {
  readonly company: Company;
  readonly owner: { readonly user: User; readonly principal: Principal; readonly membership: Membership };
  /** The company's tenant, opened through `tenant()`. */
  readonly tenant: TenantDb;
}

/**
 * A company with its owner in one line, for route tests: the owner's user and identity (global rows), the
 * company (active by default) created by them, then, through the tenant layer, their person principal, active
 * owner membership and root position on the org chart (as `POST /api/companies` makes them), so the chart starts
 * valid. Names are unique per call.
 */
export async function seedCompany(db: DbHandle, options: SeedCompanyOptions = {}): Promise<SeededCompany> {
  const tag = randomBytes(4).toString('hex');
  const raw = rawDb(db);
  const [user] = (await raw
    .insert(users)
    .values({
      primaryEmail: (options.owner?.email ?? `owner-${tag}@seed.test`).toLowerCase(),
      displayName: options.owner?.displayName ?? `Owner ${tag}`,
    })
    .returning()) as [User];
  await raw.insert(userIdentities).values({
    userId: user.id,
    provider: options.owner?.provider ?? 'fake',
    issuer: options.owner?.issuer ?? FAKE_ISSUER,
    subject: options.owner?.subject ?? `user_${tag}`,
  });
  const slug = options.slug ?? `seed-${tag}`;
  const [company] = (await raw
    .insert(companies)
    .values({
      slug,
      name: options.name ?? slug,
      status: options.status ?? 'active',
      identityOrgId: options.identityOrgId ?? null,
      createdByUserId: user.id,
    })
    .returning()) as [Company];
  const t = await tenant(db, company.id);
  const [principal] = (await t.insert(principals, { kind: 'person' }).returning()) as [Principal];
  const [membership] = (await t
    .insert(memberships, { principalId: principal.id, userId: user.id, role: 'owner', grantedRole: 'owner' })
    .returning()) as [Membership];
  await t.insert(orgPositions, { principalId: principal.id, reportsToPrincipalId: null });
  return { company, owner: { user, principal, membership }, tenant: t };
}

/** An agent's own fields to seed (the rest default as `POST .../agents` defaults them, its face 0). */
export type SeedAgentOptions = Partial<Omit<NewAgent, 'id' | 'companyId' | 'principalId'>> & {
  /**
   * Whom it reports to on the chart: a principal of the company (a person or an agent), or null for no position at
   * all. An archived agent gets no position whatever this says, as the API leaves it.
   */
  readonly reportsTo: string | null;
  readonly title?: string | null;
};

/**
 * An agent in a company, through the tenant layer: its principal (kind `agent`), its row and, unless it is archived
 * or `reportsTo` is null, its position on the chart. Its name and slug are unique per call unless given. The chart's
 * rules are not checked: a test seeds broken charts this way on purpose.
 */
export async function seedAgent(
  db: DbHandle,
  companyId: string,
  options: SeedAgentOptions,
): Promise<{ readonly principal: Principal; readonly agent: Agent }> {
  const { reportsTo, title = null, ...fields } = options;
  const tag = randomBytes(4).toString('hex');
  const t = await tenant(db, companyId);
  const [principal] = (await t.insert(principals, { kind: 'agent' }).returning()) as [Principal];
  const [agent] = (await t
    .insert(agents, {
      name: `Agent ${tag}`,
      slug: `agent-${tag}`,
      roleTitle: 'Coder',
      model: AGENT_DEFAULTS.model,
      ...fields,
      principalId: principal.id,
    })
    .returning()) as [Agent];
  if (reportsTo !== null && agent.status !== 'archived') {
    await t.insert(orgPositions, { principalId: principal.id, reportsToPrincipalId: reportsTo, title });
  }
  return { principal, agent };
}
