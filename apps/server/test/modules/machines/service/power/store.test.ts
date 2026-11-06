import { tenant } from '@mwc/db';
import { DEFAULT_MACHINE_POWER_POLICY } from '@mwc/shared/machines';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_POWER_STATE } from '../../../../../src/modules/machines/rules/power.ts';
import {
  logPower,
  nextBox,
  policyOf,
  readPower,
  saveState,
  stateOf,
} from '../../../../../src/modules/machines/service/power/store.ts';
import { enroll } from '../../../../fixtures/machines/machines.ts';
import { eventsOf, powerRow } from '../../../../fixtures/machines/power.ts';
import { membersCompany } from '../../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('reading the stored power', () => {
  it('reads each state field on its own: a bad one is null, the rest stay', () => {
    expect(stateOf(null)).toEqual(EMPTY_POWER_STATE);
    expect(stateOf('not an object')).toEqual(EMPTY_POWER_STATE);
    const state = stateOf({
      holdUntil: 5,
      holdKind: 'nap',
      holdReason: 'Held for the keep-on hours',
      box: {
        status: 'dancing',
        size: 'm',
        hourlyCost: -2,
        rules: 'none',
        checkedAt: 1,
        error: { code: 'zzz' },
      },
    });
    expect(state).toEqual({
      ...EMPTY_POWER_STATE,
      holdReason: 'Held for the keep-on hours',
      box: { status: 'unknown', size: 'm', hourlyCost: null, rules: null, checkedAt: null, error: null },
    });
    expect(stateOf({ box: 'gone' }).box).toBeNull();
  });

  it('falls back to the default policy when the stored one does not parse', () => {
    expect(policyOf(undefined)).toEqual(DEFAULT_MACHINE_POWER_POLICY);
    expect(policyOf({ keepOn: { from: '25:00' } })).toEqual(DEFAULT_MACHINE_POWER_POLICY);
    expect(policyOf({ holdAfterTurnMin: 10 }).holdAfterTurnMin).toBe(10);
    expect(nextBox(null)).toMatchObject({ status: 'unknown', checkedAt: null });
  });
});

describe('writing it', () => {
  it('makes the row on the first change, merges later ones, and cuts a long reason to 500 characters', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company);
    const t = await tenant(w.t.db, company.companyId);
    await saveState(t, machineId, {});
    expect(await powerRow(w.t.db, machineId)).toBeUndefined();
    await saveState(t, machineId, { window: '2026-11-06', holdReason: 'Held' });
    await saveState(t, machineId, { holdReason: null, lastTurnAt: '2026-11-06T12:00:00.000Z' });
    expect((await readPower(t, machineId)).state).toEqual({
      ...EMPTY_POWER_STATE,
      window: '2026-11-06',
      lastTurnAt: '2026-11-06T12:00:00.000Z',
    });
    expect((await powerRow(w.t.db, machineId))?.policy).toEqual({});
    await logPower(t, machineId, {
      action: 'kept',
      reason: 'x'.repeat(600),
      actor: 'system',
      at: new Date(),
    });
    const [event] = await eventsOf(w.t.db, machineId);
    expect(event).toBe(`kept system: ${'x'.repeat(499)}…`);
  });
});
