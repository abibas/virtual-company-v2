import {
  type AuditEntry,
  auditChanges,
  type Company,
  type CompanySet,
  companies,
  type DbHandle,
  type Membership,
  memberships,
  type NewCompanyInput,
  type Principal,
  principals,
  type TenantDb,
  withNewCompany,
} from '@mwc/db';
import { isNull, sql } from 'drizzle-orm';

/**
 * The companies module's data access, through the tenant layer only: a new company with its first rows in one
 * transaction (`withNewCompany`), the company row itself (`updateCompany`, `lockCompany`) and its audit rows.
 */
export function companiesRepo() {
  return {
    /** Inserts the company with the first free slug and runs `work` on its tenant, in one transaction. */
    create<R>(db: DbHandle, input: NewCompanyInput, work: (t: TenantDb) => Promise<R>): Promise<R> {
      return withNewCompany(db, input, work);
    },

    /** The creator's person principal and their active owner membership. */
    async addOwner(t: TenantDb, userId: string): Promise<{ principal: Principal; membership: Membership }> {
      const [principal] = (await t.insert(principals, { kind: 'person' }).returning()) as [Principal];
      const [membership] = (await t
        .insert(memberships, {
          principalId: principal.id,
          userId,
          role: 'owner',
          grantedRole: 'owner',
          status: 'active',
        })
        .returning()) as [Membership];
      return { principal, membership };
    },

    /** The company row now, locked until the transaction ends; a deleted one is refused (404). */
    lock: (t: TenantDb): Promise<Company> => t.lockCompany(),

    /** Updates the company row (after `lock`, in the same transaction) and returns it. */
    async update(t: TenantDb, set: CompanySet): Promise<Company> {
      const [row] = (await t.updateCompany(set).returning()) as [Company];
      return row;
    },

    /**
     * Links the company to its provider organization and turns it active if it was provisioning; undefined when it
     * was deleted in the meantime.
     */
    async link(t: TenantDb, orgExternalId: string, provider: string): Promise<Company | undefined> {
      const status = sql`case when ${companies.status} = 'provisioning' then 'active' else ${companies.status} end`;
      const set: CompanySet = { identityOrgId: orgExternalId, identityProvider: provider, status };
      const [row] = await t.updateCompany(set, isNull(companies.deletedAt)).returning();
      return row;
    },

    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}
