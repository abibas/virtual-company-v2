import { companies, type IdentityOutboxRow, isCompanyNotFound } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { IdentityProviderError } from '@mwc/identity-core';
import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { brokenDb, getJson } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  companyOutboxHandlers,
  createOrgHandler,
  deleteOrgHandler,
} from '../../../../src/modules/companies/service/organizations.ts';
import { OUTBOX_FIRST_DELAY_MS, processOutboxRow } from '../../../../src/platform/jobs/outbox.ts';
import { type AuthWorld, authWorld, bearer } from '../../../fixtures/auth.ts';
import {
  addUser,
  auditFields,
  auditOf,
  call,
  companyRow,
  createCompany,
  type LinkedUser,
  loseNextAnswer,
  outboxOf,
} from '../../../fixtures/companies.ts';

let w: AuthWorld;
let owner: LinkedUser;
beforeAll(async () => {
  w = await authWorld();
  owner = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const deps = () => ({ db: w.t.db, identity: w.fake });
const jobs = () => ({ db: w.t.db, clock: w.clock });
/** The company's outbox row of `op`, as it is now. */
const rowOf = async (companyId: string, op: 'create_org' | 'delete_org') =>
  (await outboxOf(w.t.db, companyId)).find((row) => row.op === op) as IdentityOutboxRow;
const runCreate = async (companyId: string) =>
  processOutboxRow(jobs(), await rowOf(companyId, 'create_org'), createOrgHandler(deps()));
const runDelete = async (companyId: string) =>
  processOutboxRow(jobs(), await rowOf(companyId, 'delete_org'), deleteOrgHandler(deps()));
/** Every organization at the fake that carries the company's id. */
const orgsOf = async (companyId: string) => {
  const found = await w.fake.findOrganizationByMetadata(IDENTITY_METADATA.companyId, companyId);
  return found === null ? [] : [found];
};
const deleteThroughApi = (companyId: string, confirmName: string) =>
  call(w, owner.token)('DELETE', `/api/companies/${companyId}`, { confirmName });

describe('create_org', () => {
  it('creates the organization with the creator as its admin, links the company and turns it active', async () => {
    const company = await createCompany(w, owner.token, { name: 'Provisioned Co' });
    expect(await runCreate(company.id)).toBe('done');
    const [org] = await orgsOf(company.id);
    expect(org).toMatchObject({ name: 'Provisioned Co', metadata: { mwc_company_id: company.id } });
    const members = [];
    for await (const member of w.fake.listOrganizationMembers(org?.externalId ?? '')) members.push(member);
    expect(members).toMatchObject([{ subject: owner.subject, providerRole: 'org:admin' }]);
    expect(await companyRow(w.t.db, company.id)).toMatchObject({
      status: 'active',
      identityOrgId: org?.externalId,
    });
    expect(await rowOf(company.id, 'create_org')).toMatchObject({
      status: 'done',
      attempts: 1,
      completedAt: w.clock(),
    });
    const provision = auditFields(await auditOf(w.t.db, company.id)).filter((r) => r.action === 'provision');
    const row = { companyId: company.id, actorKind: 'system', actorPrincipalId: null, requestId: null };
    const entity = { entityType: 'company', entityId: company.id, action: 'provision' };
    expect(provision).toEqual([
      { ...row, ...entity, field: 'identityOrgId', oldValue: null, newValue: org?.externalId },
      { ...row, ...entity, field: 'status', oldValue: 'provisioning', newValue: 'active' },
    ]);
    const res = await getJson(w.t.app, `/api/companies/${company.id}`, bearer(owner.token));
    expect(res.body).toMatchObject({ status: 'active', identityOrgId: org?.externalId });
    // Run again (a duplicate delivery): the company is linked, nothing more happens.
    const create = vi.spyOn(w.fake, 'createOrganization');
    await createOrgHandler(deps())(await rowOf(company.id, 'create_org'));
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('never creates a second organization when a retry follows a failure after the provider created one', async () => {
    const company = await createCompany(w, owner.token, { name: 'Lost Answer Co' });
    loseNextAnswer(w.fake, 'createOrganization');
    expect(await runCreate(company.id)).toBe('retry');
    expect(await orgsOf(company.id)).toHaveLength(1);
    const failed = await rowOf(company.id, 'create_org');
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'unavailable: fake: the answer of createOrganization was lost',
      nextAttemptAt: new Date(w.clock().getTime() + OUTBOX_FIRST_DELAY_MS),
    });
    expect(await companyRow(w.t.db, company.id)).toMatchObject({
      status: 'provisioning',
      identityOrgId: null,
    });

    const create = vi.spyOn(w.fake, 'createOrganization');
    expect(await runCreate(company.id)).toBe('done');
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    const orgs = await orgsOf(company.id);
    expect(orgs).toHaveLength(1);
    const all = [];
    for await (const m of w.fake.listOrganizationMembers(orgs[0]?.externalId ?? '')) all.push(m.subject);
    expect(all).toEqual([owner.subject]);
    expect(await companyRow(w.t.db, company.id)).toMatchObject({
      status: 'active',
      identityOrgId: orgs[0]?.externalId,
    });
    expect(await rowOf(company.id, 'create_org')).toMatchObject({
      status: 'done',
      attempts: 2,
      lastError: null,
    });
  });

  it('leaves the row for a retry when the provider fails before acting, then creates one organization', async () => {
    const company = await createCompany(w, owner.token, { name: 'Down Provider Co' });
    w.fake.failNext('findOrganizationByMetadata');
    expect(await runCreate(company.id)).toBe('retry');
    w.fake.failNext(
      'createOrganization',
      new IdentityProviderError('rate_limited', 'slow down', { retryAfterMs: 90_000 }),
    );
    expect(await runCreate(company.id)).toBe('retry');
    expect(await rowOf(company.id, 'create_org')).toMatchObject({
      attempts: 2,
      lastError: 'rate_limited: slow down',
      nextAttemptAt: new Date(w.clock().getTime() + 90_000),
    });
    expect(await orgsOf(company.id)).toEqual([]);
    expect(await runCreate(company.id)).toBe('done');
    expect(await orgsOf(company.id)).toHaveLength(1);
  });

  it('links an organization that already carries the company id instead of creating one', async () => {
    const company = await createCompany(w, owner.token, { name: 'Found Co' });
    const existing = await w.fake.createOrganization({
      name: 'Found Co',
      metadata: { mwc_company_id: company.id },
    });
    const create = vi.spyOn(w.fake, 'createOrganization');
    expect(await runCreate(company.id)).toBe('done');
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    expect((await companyRow(w.t.db, company.id))?.identityOrgId).toBe(existing.externalId);
  });

  it('never sends the company slug (it is ours), and creates the organization without a creator if none', async () => {
    const company = await createCompany(w, owner.token, { name: 'No Slug Co' });
    expect(company.slug).toBe('no-slug-co');
    const row = { ...(await rowOf(company.id, 'create_org')), payload: {} };
    const create = vi.spyOn(w.fake, 'createOrganization');
    expect(await processOutboxRow(jobs(), row, createOrgHandler(deps()))).toBe('done');
    expect(create).toHaveBeenCalledWith({ name: 'No Slug Co', metadata: { mwc_company_id: company.id } });
    create.mockRestore();
    const [org] = await orgsOf(company.id);
    expect(org?.slug).toBeUndefined();
    const members = [];
    for await (const member of w.fake.listOrganizationMembers(org?.externalId ?? '')) members.push(member);
    expect(members).toEqual([]);
  });

  it('does nothing for a company deleted before it ran, or deleted while it ran', async () => {
    const gone = await createCompany(w, owner.token, { name: 'Gone Early' });
    expect((await deleteThroughApi(gone.id, 'Gone Early')).status).toBe(204);
    expect(await runCreate(gone.id)).toBe('done');
    expect(await orgsOf(gone.id)).toEqual([]);

    const racing = await createCompany(w, owner.token, { name: 'Gone Midway' });
    const find = vi.spyOn(w.fake, 'findOrganizationByMetadata').mockImplementationOnce(async () => {
      await rawDb(w.t.db)
        .update(companies)
        .set({ status: 'deleted', deletedAt: w.clock() })
        .where(eq(companies.id, racing.id));
      return null;
    });
    expect(await runCreate(racing.id)).toBe('done');
    find.mockRestore();
    expect(await companyRow(w.t.db, racing.id)).toMatchObject({ status: 'deleted', identityOrgId: null });
    expect((await auditOf(w.t.db, racing.id)).filter((r) => r.action === 'provision')).toEqual([]);
    // The organization it made meanwhile is found by its metadata and removed by delete_org.
    expect(await orgsOf(racing.id)).toHaveLength(1);
    const cleanup = { ...(await rowOf(racing.id, 'create_org')), op: 'delete_org' as const, payload: {} };
    await deleteOrgHandler(deps())(cleanup);
    expect(await orgsOf(racing.id)).toEqual([]);
  });

  it('fails, for a retry, without an identity provider or when the database is away', async () => {
    const company = await createCompany(w, owner.token, { name: 'No Provider Co' });
    const row = await rowOf(company.id, 'create_org');
    await expect(createOrgHandler({ db: w.t.db, identity: undefined })(row)).rejects.toThrow(
      /MWC_IDENTITY=none/,
    );
    // A database failure is not a deleted company: it is thrown, so the row is tried again.
    const failure = await createOrgHandler({ db: brokenDb(), identity: w.fake })(row).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(isCompanyNotFound(failure)).toBe(false);
    expect(await orgsOf(company.id)).toEqual([]);
  });
});

describe('delete_org', () => {
  it('deletes the recorded organization, and a second run finds it already gone', async () => {
    const company = await createCompany(w, owner.token, { name: 'Delete Org Co' });
    await runCreate(company.id);
    const [org] = await orgsOf(company.id);
    expect((await deleteThroughApi(company.id, 'Delete Org Co')).status).toBe(204);
    expect((await rowOf(company.id, 'delete_org')).payload).toEqual({ orgExternalId: org?.externalId });
    expect(await runDelete(company.id)).toBe('done');
    expect(await orgsOf(company.id)).toEqual([]);
    expect(await rowOf(company.id, 'delete_org')).toMatchObject({ status: 'done', attempts: 1 });
    await expect(deleteOrgHandler(deps())(await rowOf(company.id, 'delete_org'))).resolves.toBeUndefined();
  });

  it('finds the organization by metadata for a company deleted while provisioning, and needs none', async () => {
    const company = await createCompany(w, owner.token, { name: 'Half Made Co' });
    loseNextAnswer(w.fake, 'createOrganization');
    expect(await runCreate(company.id)).toBe('retry');
    expect((await deleteThroughApi(company.id, 'Half Made Co')).status).toBe(204);
    expect((await rowOf(company.id, 'delete_org')).payload).toEqual({ orgExternalId: null });
    expect(await runDelete(company.id)).toBe('done');
    expect(await orgsOf(company.id)).toEqual([]);

    const never = await createCompany(w, owner.token, { name: 'Never Made Co' });
    expect((await deleteThroughApi(never.id, 'Never Made Co')).status).toBe(204);
    const remove = vi.spyOn(w.fake, 'deleteOrganization');
    expect(await runDelete(never.id)).toBe('done');
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it('counts not_found as gone, and retries any other provider failure', async () => {
    const company = await createCompany(w, owner.token, { name: 'Flaky Delete Co' });
    await runCreate(company.id);
    expect((await deleteThroughApi(company.id, 'Flaky Delete Co')).status).toBe(204);
    w.fake.failNext('deleteOrganization');
    expect(await runDelete(company.id)).toBe('retry');
    expect(await orgsOf(company.id)).toHaveLength(1);
    expect(await runDelete(company.id)).toBe('done');
    const row = await rowOf(company.id, 'delete_org');
    w.fake.failNext('deleteOrganization', new IdentityProviderError('not_found', 'no such organization'));
    await expect(deleteOrgHandler(deps())(row)).resolves.toBeUndefined();
    await expect(deleteOrgHandler({ db: w.t.db, identity: undefined })(row)).rejects.toThrow(
      /MWC_IDENTITY=none/,
    );
  });

  it('is offered with create_org by the module, by op', () => {
    expect(Object.keys(companyOutboxHandlers(deps())).sort()).toEqual(['create_org', 'delete_org']);
  });
});
