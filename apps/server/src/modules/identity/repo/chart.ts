import { type AuditEntry, isCompanyNotFound, type Membership, type TenantDb } from '@mwc/db';
import { type RawDb, tenantOf } from '@mwc/db/system';
import type { MembershipStatus } from '@mwc/shared/enums';

/** Who moves people on the chart, on its audit rows: the system for a projection or a reconcile, a member otherwise. */
export type ChartActor = Pick<AuditEntry, 'actorKind' | 'actorPrincipalId' | 'requestId'>;

/**
 * What a membership's start and end do to its company's org chart, in the membership's own transaction and under the
 * company row's lock, which the caller holds. It is the org module's `memberChart`, which `createApp` passes in (as
 * `ChartDeps`), so neither this module nor the members module imports the org module, which reads people's profiles
 * here.
 */
export interface MemberChart {
  /** A membership became active: the person gets a position, unless they have one already. */
  placeMember(
    t: TenantDb,
    member: { readonly principalId: string; readonly invitationId: string | null },
    by: ChartActor,
  ): Promise<void>;
  /** A membership stopped being active (removed, suspended): the person's reports move up and their position goes. */
  unplaceMember(t: TenantDb, principalId: string, by: ChartActor): Promise<void>;
}

/** The dependency of the paths that start or end a membership. */
export interface ChartDeps {
  readonly chart: MemberChart;
}

/** What a change of a membership's status does on the chart: place the person, take them off, or nothing. */
export function chartStep(
  before: MembershipStatus | undefined,
  after: MembershipStatus,
): 'place' | 'unplace' | undefined {
  if (after === 'active' && before !== 'active') return 'place';
  if (before === 'active' && after !== 'active') return 'unplace';
  return undefined;
}

/**
 * The company's tenant on this transaction with the company row locked (`for update`), so the chart change and the
 * membership's write are serialized with every other change of the chart; undefined for a deleted company, whose chart
 * stays as it is.
 */
export async function lockedTenant(db: RawDb, companyId: string): Promise<TenantDb | undefined> {
  try {
    const t = await tenantOf(db, companyId);
    await t.lockCompany();
    return t;
  } catch (error) {
    if (isCompanyNotFound(error)) return undefined;
    throw error;
  }
}

/** Places or takes off the chart the person of a membership whose status changed (`chartStep`). */
export function moveOnChart(
  t: TenantDb,
  step: 'place' | 'unplace',
  saved: Pick<Membership, 'principalId' | 'invitationId'>,
  hook: { readonly chart: MemberChart; readonly by: ChartActor },
): Promise<void> {
  if (step === 'unplace') return hook.chart.unplaceMember(t, saved.principalId, hook.by);
  return hook.chart.placeMember(
    t,
    { principalId: saved.principalId, invitationId: saved.invitationId },
    hook.by,
  );
}
