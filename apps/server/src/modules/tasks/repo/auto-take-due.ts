import { companies, type DbHandle, flows } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq, isNull, ne } from 'drizzle-orm';

/**
 * The flows with auto-take on across every company (T-25), for the server's start: listed in biome.json's exemption,
 * since any flow may have missed a take while the server was down. Each is then taken from through its company's
 * tenant (`service/auto-take.ts`).
 */

/** A flow with auto-take on, in a company not deleted. */
export interface AutoTakeFlow {
  readonly companyId: string;
  readonly flowId: string;
}

export async function autoTakeFlows(db: DbHandle): Promise<AutoTakeFlow[]> {
  return rawDb(db)
    .select({ companyId: flows.companyId, flowId: flows.id })
    .from(flows)
    .innerJoin(companies, eq(companies.id, flows.companyId))
    .where(and(eq(flows.autoTake, true), ne(companies.status, 'deleted'), isNull(companies.deletedAt)));
}
