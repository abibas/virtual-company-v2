import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  agents,
  type Company,
  type NewAgent,
  type NewOrgPosition,
  orgPositions,
  principals,
} from '../../src/schema/index.ts';
import { tenant } from '../../src/tenant.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMember,
  insertPrincipal,
  MISSING_ID,
  migratedTestDb,
  unique,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
});
afterAll(() => testDb.close());

function position(companyId: string, values: Omit<NewOrgPosition, 'companyId'>) {
  return handle.db
    .insert(orgPositions)
    .values({ companyId, ...values })
    .returning();
}

describe('agents', () => {
  it('stores an agent on its principal with the defaults', async () => {
    const principal = await insertPrincipal(handle, acme.id, 'agent');
    const agent = await insertAgent(handle, acme.id, { principalId: principal.id, name: 'SLOP BOX' });
    expect(agent).toMatchObject({
      companyId: acme.id,
      principalId: principal.id,
      name: 'SLOP BOX',
      roleTitle: 'Coder',
      status: 'active',
      harness: 'claude_code',
      model: 'claude-opus-5-5',
      effort: 'high',
      instructions: '',
      instructionsRev: 1,
      maxConcurrentRuns: 1,
      face: 0,
      settings: {},
    });
    expect(agent.createdAt).toBeInstanceOf(Date);
  });

  it('keeps one agent per principal and a slug once per company', async () => {
    const first = await insertAgent(handle, acme.id);
    expect(await pgError(insertAgent(handle, acme.id, { principalId: first.principalId }))).toMatchObject({
      code: '23505',
      constraint: 'agents_company_id_principal_id_unique',
    });
    expect(await pgError(insertAgent(handle, acme.id, { slug: first.slug }))).toMatchObject({
      code: '23505',
      constraint: 'agents_company_id_slug_unique',
    });
    // Another company may use the same slug.
    await expect(insertAgent(handle, globex.id, { slug: first.slug })).resolves.toMatchObject({
      slug: first.slug,
    });
  });

  it("refuses another company's principal (a composite key) and an unknown one", async () => {
    const theirs = await insertPrincipal(handle, globex.id, 'agent');
    for (const principalId of [theirs.id, MISSING_ID]) {
      expect(await pgError(insertAgent(handle, acme.id, { principalId }))).toMatchObject({
        code: '23503',
        constraint: 'agents_principal_fk',
      });
    }
  });

  it('holds every value to its CHECK, and takes the bounds', async () => {
    const checks: [Partial<NewAgent>, string][] = [
      [{ name: '' }, 'agents_name_check'],
      [{ name: 'n'.repeat(81) }, 'agents_name_check'],
      [{ roleTitle: '' }, 'agents_role_title_check'],
      [{ roleTitle: 'r'.repeat(81) }, 'agents_role_title_check'],
      [{ instructionsRev: 0 }, 'agents_instructions_rev_check'],
      [{ maxConcurrentRuns: 0 }, 'agents_max_concurrent_runs_check'],
      [{ maxConcurrentRuns: 9 }, 'agents_max_concurrent_runs_check'],
      [{ face: -1 }, 'agents_face_check'],
      [{ face: 42 }, 'agents_face_check'],
    ];
    for (const [values, constraint] of checks) {
      expect(await pgError(insertAgent(handle, acme.id, values)), constraint).toMatchObject({
        code: '23514',
        constraint,
      });
    }
    const bounds = await insertAgent(handle, acme.id, {
      name: 'n'.repeat(80),
      roleTitle: 'r',
      slug: unique('a').padEnd(63, 'x'),
      status: 'archived',
      harness: 'codex',
      effort: 'xhigh',
      instructions: 'Ship small commits.',
      instructionsRev: 7,
      maxConcurrentRuns: 8,
      face: 41,
      settings: { worktrees: true },
    });
    expect(bounds).toMatchObject({ maxConcurrentRuns: 8, face: 41, settings: { worktrees: true } });
    expect(bounds.slug).toHaveLength(63);
  });

  it.each(['Acme', '-acme', 'acme-', 'ac_me', 'acme corp', '', 'a'.repeat(64)])(
    'refuses the slug %j, as company slugs',
    async (slug) => {
      expect(await pgError(insertAgent(handle, acme.id, { slug }))).toMatchObject({
        code: '23514',
        constraint: 'agents_slug_check',
      });
    },
  );

  it.each([
    ['status', 'agents_status_check'],
    ['harness', 'agents_harness_check'],
    ['effort', 'agents_effort_check'],
  ] as const)('refuses an unknown %s', async (column, constraint) => {
    expect(await pgError(insertAgent(handle, acme.id, { [column]: 'turbo' }))).toMatchObject({
      code: '23514',
      constraint,
    });
  });
});

describe('org_positions', () => {
  it('stores a root and a report under it, with no title by default', async () => {
    const owner = await insertMember(handle, acme.id, { role: 'owner', grantedRole: 'owner' });
    const agent = await insertAgent(handle, acme.id);
    const [root] = await position(acme.id, { principalId: owner.principal.id });
    expect(root).toMatchObject({
      companyId: acme.id,
      principalId: owner.principal.id,
      reportsToPrincipalId: null,
      title: null,
    });
    const [report] = await position(acme.id, {
      principalId: agent.principalId,
      reportsToPrincipalId: owner.principal.id,
      title: 't'.repeat(80),
    });
    expect(report).toMatchObject({ reportsToPrincipalId: owner.principal.id, title: 't'.repeat(80) });
  });

  it('keeps one position per principal, and nobody reports to themselves', async () => {
    const { principal } = await insertMember(handle, acme.id);
    await position(acme.id, { principalId: principal.id });
    expect(await pgError(position(acme.id, { principalId: principal.id }))).toMatchObject({
      code: '23505',
      constraint: 'org_positions_pkey',
    });
    const other = await insertPrincipal(handle, acme.id);
    expect(
      await pgError(position(acme.id, { principalId: other.id, reportsToPrincipalId: other.id })),
    ).toMatchObject({ code: '23514', constraint: 'org_positions_not_self_check' });
  });

  it('refuses a title over 80 characters', async () => {
    const other = await insertPrincipal(handle, acme.id);
    expect(await pgError(position(acme.id, { principalId: other.id, title: 't'.repeat(81) }))).toMatchObject({
      code: '23514',
      constraint: 'org_positions_title_check',
    });
  });

  it("refuses another company's principal, as the position or as the manager, and an unknown one", async () => {
    const ours = await insertPrincipal(handle, acme.id);
    const theirs = await insertPrincipal(handle, globex.id);
    for (const principalId of [theirs.id, MISSING_ID]) {
      expect(await pgError(position(acme.id, { principalId }))).toMatchObject({
        code: '23503',
        constraint: 'org_positions_principal_fk',
      });
    }
    for (const reportsToPrincipalId of [theirs.id, MISSING_ID]) {
      expect(await pgError(position(acme.id, { principalId: ours.id, reportsToPrincipalId }))).toMatchObject({
        code: '23503',
        constraint: 'org_positions_reports_to_fk',
      });
    }
  });
});

describe('the org tables through the tenant layer', () => {
  it("stamps the company on agents and positions and reads only this company's", async () => {
    const t = await tenant(handle, acme.id);
    const theirs = await insertAgent(handle, globex.id);
    const [principal] = await t.insert(principals, { kind: 'agent' }).returning();
    const smuggled = { companyId: globex.id } as object;
    const [agent] = await t
      .insert(agents, {
        ...smuggled,
        principalId: principal?.id ?? '',
        name: 'Reviewer',
        slug: unique('reviewer'),
        roleTitle: 'Code reviewer',
        model: 'claude-opus-5-5',
      })
      .returning();
    expect(agent?.companyId).toBe(acme.id);
    const mine = await t.select(agents).orderBy(asc(agents.id));
    expect(mine.every((row) => row.companyId === acme.id)).toBe(true);
    expect(mine.map((row) => row.id)).toContain(agent?.id);
    expect(await t.select(agents, eq(agents.id, theirs.id))).toEqual([]);

    const manager = await insertMember(handle, acme.id, { role: 'owner', grantedRole: 'owner' });
    await t.insert(orgPositions, { principalId: manager.principal.id });
    const [placed] = await t
      .insert(orgPositions, { principalId: principal?.id ?? '', reportsToPrincipalId: manager.principal.id })
      .returning();
    expect(placed).toMatchObject({ companyId: acme.id, reportsToPrincipalId: manager.principal.id });
    expect(await t.select(orgPositions, eq(orgPositions.principalId, theirs.principalId))).toEqual([]);
  });

  it("moves and removes only this company's positions, and refuses a manager from another company", async () => {
    const t = await tenant(handle, acme.id);
    const g = await tenant(handle, globex.id);
    const ours = await insertPrincipal(handle, acme.id);
    const boss = await insertPrincipal(handle, acme.id);
    const theirs = await insertPrincipal(handle, globex.id);
    await t.insert(orgPositions, [{ principalId: ours.id }, { principalId: boss.id }]);
    await g.insert(orgPositions, { principalId: theirs.id });

    const moved = await t
      .update(
        orgPositions,
        { reportsToPrincipalId: boss.id, title: 'Lead' },
        eq(orgPositions.principalId, ours.id),
      )
      .returning();
    expect(moved).toMatchObject([{ principalId: ours.id, reportsToPrincipalId: boss.id, title: 'Lead' }]);
    expect(
      await t.update(orgPositions, { title: 'Nope' }, eq(orgPositions.principalId, theirs.id)).returning(),
    ).toEqual([]);
    const cross = t.update(
      orgPositions,
      { reportsToPrincipalId: theirs.id },
      eq(orgPositions.principalId, ours.id),
    );
    expect(await pgError(cross)).toMatchObject({ code: '23503', constraint: 'org_positions_reports_to_fk' });

    expect(await t.delete(orgPositions, eq(orgPositions.principalId, theirs.id)).returning()).toEqual([]);
    expect(await g.select(orgPositions, eq(orgPositions.principalId, theirs.id))).toHaveLength(1);
    expect(await t.delete(orgPositions, eq(orgPositions.principalId, ours.id)).returning()).toHaveLength(1);
  });
});
