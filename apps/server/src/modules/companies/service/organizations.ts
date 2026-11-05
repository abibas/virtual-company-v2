import { type Company, type DbHandle, diffFields, type IdentityOutboxRow } from '@mwc/db';
import { type IdentityProvider, isIdentityProviderError } from '@mwc/identity-core';
import { type ExternalOrg, IDENTITY_METADATA } from '@mwc/shared/identity';
import {
  type OutboxHandler,
  type OutboxHandlers,
  outboxProvider,
  outboxTenant,
} from '../../../platform/jobs/outbox.ts';
import { companiesRepo } from '../repo.ts';
import { audited } from '../rules.ts';

/**
 * The company's organization at the identity provider: the `create_org` and `delete_org` outbox handlers, which the
 * jobs loop (S1.10) calls through `processOutboxRow` (`platform/jobs/outbox.ts`). Each is idempotent: a retry after
 * any failure, even one that came after the provider acted, converges on one organization or none.
 */

export interface OrganizationDeps {
  readonly db: DbHandle;
  readonly identity: IdentityProvider | undefined;
}

/** The organization of `findOrganizationByMetadata`: the company's id in its private metadata. */
const findOrganization = (provider: IdentityProvider, companyId: string) =>
  provider.findOrganizationByMetadata(IDENTITY_METADATA.companyId, companyId);

/**
 * Creates the organization with the company's name and id (private metadata), its creator as the first member. No
 * slug: the company's slug is ours (`/:slug`), and the provider's would be a second one in its own namespace that
 * nothing keeps up to date (Clerk refuses any slug while its organization slugs are off, their default).
 */
function createOrganization(provider: IdentityProvider, company: Company, payload: Record<string, unknown>) {
  const creator = payload.createdBySubject;
  return provider.createOrganization({
    name: company.name,
    metadata: { [IDENTITY_METADATA.companyId]: company.id },
    ...(typeof creator === 'string' ? { createdBySubject: creator } : {}),
  });
}

/**
 * `create_org`: looks for the company's organization by metadata first and creates one only when there is none, so
 * a retry after a lost answer finds the one already made; then stores `identity_org_id` and turns the company
 * active (an audit row per field, by the system). A company already linked, or deleted meanwhile, needs nothing
 * (`delete_org` removes whatever exists). A provider error rejects, and the row is tried again.
 */
export function createOrgHandler(deps: OrganizationDeps): OutboxHandler {
  const repo = companiesRepo();
  return async (row: IdentityOutboxRow) => {
    const provider = outboxProvider(deps.identity);
    const t = await outboxTenant(deps.db, row.companyId);
    if (t === undefined || t.company.identityOrgId !== null) return;
    const company = t.company;
    const org: ExternalOrg =
      (await findOrganization(provider, company.id)) ??
      (await createOrganization(provider, company, row.payload));
    await t.transaction(async (tx) => {
      const after = await repo.link(tx, org.externalId, provider.kind);
      if (after === undefined) return;
      await repo.audit(tx, {
        actorKind: 'system',
        entityType: 'company',
        entityId: company.id,
        action: 'provision',
        changes: diffFields(audited(company), audited(after)),
      });
    });
  };
}

/**
 * `delete_org`: deletes the organization recorded when the company was deleted, or the one found by metadata when
 * the company had none yet (deleted while provisioning). No organization, or one already gone, is success.
 */
export function deleteOrgHandler(deps: OrganizationDeps): OutboxHandler {
  return async (row: IdentityOutboxRow) => {
    const provider = outboxProvider(deps.identity);
    const recorded = row.payload.orgExternalId;
    const orgId =
      typeof recorded === 'string' ? recorded : (await findOrganization(provider, row.companyId))?.externalId;
    if (orgId === undefined) return;
    try {
      await provider.deleteOrganization(orgId);
    } catch (error) {
      if (!isIdentityProviderError(error, 'not_found')) throw error;
    }
  };
}

/** The companies module's outbox handlers, by op, for the jobs loop. */
export function companyOutboxHandlers(deps: OrganizationDeps): OutboxHandlers {
  return { create_org: createOrgHandler(deps), delete_org: deleteOrgHandler(deps) };
}
