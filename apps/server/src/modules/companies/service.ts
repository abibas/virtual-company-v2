import { randomBytes } from 'node:crypto';
import { type Company, diffFields, isUniqueViolation, SlugTakenError, type TenantDb } from '@mwc/db';
import type { Actor, MemberContext } from '../../platform/auth/actor.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { enqueueOutbox, outboxKey } from '../../platform/jobs/outbox.ts';
import { companiesOf, profileOf } from '../identity/service.ts';
import { companiesRepo } from './repo.ts';
import { audited, changedFields, creationRefusal, nameConfirmed, slugCandidates } from './rules.ts';
import type { CompanySummary, CompanyView, CreateCompany, UpdateCompany } from './schemas.ts';

/** A refusal the routes answer in the common error shape. */
export interface Refusal {
  readonly ok: false;
  readonly status: 403 | 409 | 422;
  readonly code: string;
  readonly message: string;
}

const refuse = (status: Refusal['status'], code: string, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message,
});

const POLICY_MESSAGES = {
  company_creation_disabled: 'Creating companies is switched off on this server',
  company_creation_not_allowed: 'Your account may not create companies on this server',
} as const;

/** Six random base-36 characters: the suffix of a derived slug when the numbered ones are taken. */
export const randomSuffix = () => (randomBytes(4).readUInt32BE(0) % 36 ** 6).toString(36).padStart(6, '0');

/** The company as the API shows it. */
export function companyView(company: Company): CompanyView {
  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    status: company.status,
    identityOrgId: company.identityOrgId,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

/** Who creates the company: a person signed in with a session and linked here (`GET /api/me` links them). */
function creatorOf(actor: Actor): { userId: string; subject: string } | Refusal {
  if (actor.via !== 'clerk' || actor.identity === undefined) {
    return refuse(403, 'forbidden', 'Companies are created signed in to the web app, not with an API key');
  }
  if (actor.userId === undefined) {
    return refuse(403, 'user_not_linked', 'Finish signing in first: call GET /api/me once');
  }
  return { userId: actor.userId, subject: actor.identity.subject };
}

const slugTaken = (slug: string | undefined) =>
  refuse(
    409,
    'slug_taken',
    slug ? `The slug ${slug} is taken` : 'No free slug was found for this name; choose one',
  );

type Repo = ReturnType<typeof companiesRepo>;
type Deps = Pick<ServerDeps, 'db' | 'config' | 'identity'>;

/** Who did what to the company, for its audit rows. */
const entry = (t: TenantDb, actorPrincipalId: string, requestId: string, action: string) =>
  ({
    actorKind: 'user',
    actorPrincipalId,
    requestId,
    entityType: 'company',
    entityId: t.companyId,
    action,
  }) as const;

/** The creation policy for a creator (MWC_COMPANY_CREATION); the allowlist reads their primary email. */
async function policyRefusal(deps: Deps, userId: string): Promise<Refusal | undefined> {
  const { MWC_COMPANY_CREATION: policy, MWC_COMPANY_CREATORS: creators } = deps.config;
  const email = policy === 'allowlist' ? (await profileOf(deps.db, userId))?.primaryEmail : undefined;
  const refusal = creationRefusal(policy, creators, email);
  return refusal && refuse(403, refusal, POLICY_MESSAGES[refusal]);
}

/**
 * Creates a company in one transaction: the company (provisioning) with the first free slug, the creator's person
 * principal and active owner membership, the outbox `create_org` call (idempotency key `create_org:<companyId>`)
 * and its audit rows. The identity provider is called later, by the outbox handler.
 */
async function createCompany(
  deps: Deps,
  repo: Repo,
  random: () => string,
  call: { actor: Actor; input: CreateCompany; requestId: string },
): Promise<{ ok: true; company: Company } | Refusal> {
  const creator = creatorOf(call.actor);
  if ('ok' in creator) return creator;
  const refusal = await policyRefusal(deps, creator.userId);
  if (refusal) return refusal;
  const { name, slug } = call.input;
  const input = { name, slugs: slugCandidates(name, slug, random), createdByUserId: creator.userId };
  try {
    const company = await repo.create(
      deps.db,
      { ...input, identityProvider: deps.identity?.kind },
      async (t) => {
        const owner = await repo.addOwner(t, creator.userId);
        await enqueueOutbox(t, {
          op: 'create_org',
          idempotencyKey: outboxKey('create_org', t.companyId),
          payload: { createdBySubject: creator.subject },
        });
        await repo.audit(t, {
          ...entry(t, owner.principal.id, call.requestId, 'create'),
          changes: diffFields(null, audited(t.company)),
        });
        return t.company;
      },
    );
    return { ok: true, company };
  } catch (error) {
    if (error instanceof SlugTakenError) return slugTaken(slug);
    throw error;
  }
}

/** My companies, exactly as `GET /api/me` lists them, with my role and membership status in each. */
async function listCompanies(deps: Deps, actor: Actor): Promise<CompanySummary[]> {
  return (await companiesOf(deps.db, actor)).map((row) => ({
    id: row.companyId,
    slug: row.slug,
    name: row.name,
    status: row.companyStatus,
    role: row.role,
    membershipStatus: row.status,
  }));
}

/** Renames the company or changes its slug, with one audit row per changed field; a taken slug is a 409. */
async function updateCompany(
  repo: Repo,
  t: TenantDb,
  call: { member: MemberContext; patch: UpdateCompany; requestId: string },
): Promise<{ ok: true; company: Company } | Refusal> {
  try {
    const company = await t.transaction(async (tx) => {
      const before = await repo.lock(tx);
      const set = changedFields(before, call.patch);
      if (Object.keys(set).length === 0) return before;
      const after = await repo.update(tx, set);
      await repo.audit(tx, {
        ...entry(tx, call.member.principalId, call.requestId, 'update'),
        changes: diffFields(audited(before), audited(after)),
      });
      return after;
    });
    return { ok: true, company };
  } catch (error) {
    if (isUniqueViolation(error, 'companies_slug_unique')) return slugTaken(call.patch.slug);
    throw error;
  }
}

/**
 * Soft-deletes the company when `confirmName` is its name (422 otherwise): `status = deleted` and `deleted_at`, the
 * outbox `delete_org` call (with the organization, if it has one) and the audit rows, in one transaction. `tenant()`
 * refuses the company from then on, so it is a 404 for everyone; its memberships and the rest stay for a later purge.
 */
function removeCompany(
  repo: Repo,
  t: TenantDb,
  call: { member: MemberContext; confirmName: string; requestId: string; now: Date },
): Promise<{ ok: true } | Refusal> {
  return t.transaction(async (tx) => {
    const before = await repo.lock(tx);
    if (!nameConfirmed(call.confirmName, before.name)) {
      return refuse(422, 'confirmation_mismatch', 'Type the company name exactly as it is to delete it');
    }
    const after = await repo.update(tx, { status: 'deleted', deletedAt: call.now });
    await enqueueOutbox(tx, {
      op: 'delete_org',
      idempotencyKey: outboxKey('delete_org', tx.companyId),
      payload: { orgExternalId: before.identityOrgId },
    });
    await repo.audit(tx, {
      ...entry(tx, call.member.principalId, call.requestId, 'delete'),
      changes: diffFields(audited(before), audited(after)),
    });
    return { ok: true as const };
  });
}

export interface CompaniesServiceOptions {
  /** The random suffix of a derived slug (tests pin it). */
  readonly randomSuffix?: () => string;
}

/** The companies module's logic: create, list, update and delete; the outbox handlers are in `service/`. */
export function companiesService(deps: Deps, options: CompaniesServiceOptions = {}) {
  const repo = companiesRepo();
  const random = options.randomSuffix ?? randomSuffix;
  return {
    create: (actor: Actor, input: CreateCompany, requestId: string) =>
      createCompany(deps, repo, random, { actor, input, requestId }),
    list: (actor: Actor) => listCompanies(deps, actor),
    update: (t: TenantDb, member: MemberContext, patch: UpdateCompany, requestId: string) =>
      updateCompany(repo, t, { member, patch, requestId }),
    remove: (t: TenantDb, member: MemberContext, confirmName: string, requestId: string, now: Date) =>
      removeCompany(repo, t, { member, confirmName, requestId, now }),
  };
}

export type CompaniesService = ReturnType<typeof companiesService>;
