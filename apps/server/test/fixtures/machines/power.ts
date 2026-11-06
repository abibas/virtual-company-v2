/**
 * The power tests' helpers: a FakePowerDriver holding the devbox, a controller (a FakeRunner whose caps say it powers
 * devboxes, answering each `power.command` from the driver as a real controller's runner would), the devbox's own
 * runner, and the raw power rows a machine leaves behind.
 */
import { type DbHandle, machinePower, machinePowerEvents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { isMachinePowerError, type PowerReading } from '@mwc/machines-core';
import { FakePowerDriver, type FakeSettleMode } from '@mwc/machines-core/fake';
import type { AiriaDevboxRef, MachinePowerPolicyInput, PowerStatus } from '@mwc/shared/machines';
import type { PowerCommand, PowerResult, RunnerFrame, ServerFrame } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { asc, eq } from 'drizzle-orm';
import { as, type MembersCompany } from '../members/members.ts';
import { DEVBOX, enroll, MAC, machinesPath } from './machines.ts';
import type { MachinesWorld } from './world.ts';

export const BOX_REF = DEVBOX.providerRef as AiriaDevboxRef;

/** A driver with the devbox (size m, $0.268 an hour), stopped unless told. */
export const boxDriver = (status: PowerStatus = 'stopped', settle: FakeSettleMode = 'next_status') =>
  new FakePowerDriver({ boxes: [{ ref: BOX_REF, status, hourlyCost: 0.268 }], settle });

function call(driver: FakePowerDriver, command: PowerCommand): Promise<PowerReading> {
  const { ref } = command.target;
  if (command.action === 'start') return driver.start(ref);
  if (command.action === 'stop') return driver.stop(ref);
  if (command.action === 'status') return driver.status(ref);
  return driver.setTimezone(ref, command.args?.timezone ?? '');
}

/** A controller's answer: the driver's reading as status and metadata, or its error as `<code>: <message>`. */
export async function answer(driver: FakePowerDriver, command: PowerCommand): Promise<PowerResult> {
  const base = { type: 'power.result' as const, cmdId: command.cmdId };
  try {
    const reading = await call(driver, command);
    const metadata = {
      size: reading.size ?? null,
      hourlyCost: reading.hourlyCost ?? null,
      rules: reading.rules,
    };
    return { ...base, ok: true, status: reading.status, metadata };
  } catch (error) {
    if (!isMachinePowerError(error)) throw error;
    return { ...base, ok: false, error: `${error.code}: ${error.message}` };
  }
}

/** Connects a controller with `key`: its runner powers devboxes from `driver`, and acks every other command. */
export async function connectController(
  w: MachinesWorld,
  key: string,
  driver: FakePowerDriver,
): Promise<FakeRunner> {
  const holder: { runner?: FakeRunner } = {};
  const respond = (frame: ServerFrame): RunnerFrame[] => {
    if (frame.type !== 'power.command')
      return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
    void answer(driver, frame).then((result) => {
      if (holder.runner?.connected) holder.runner.send(result);
    });
    return [];
  };
  holder.runner = await w.connect(key, { caps: { power: ['airia_devbox'] }, respond });
  return holder.runner;
}

/** The company's Mac and devbox, enrolled through the API. */
export async function macAndBox(w: MachinesWorld, company: MembersCompany) {
  const mac = await enroll(w, company, MAC);
  const box = await enroll(w, company, DEVBOX);
  return { mac, box };
}

export const powerPath = (company: MembersCompany, machineId: string, rest = '') =>
  machinesPath(company, `/${machineId}/power${rest}`);

/** Puts a policy through the API as the company's owner (the test fails on anything but a 200). */
export async function putPolicy(
  w: MachinesWorld,
  company: MembersCompany,
  machineId: string,
  policy: MachinePowerPolicyInput,
): Promise<void> {
  const res = await as(w, company.owner)('PUT', powerPath(company, machineId), policy);
  if (res.status !== 200) throw new Error(`PUT power answered ${res.status}: ${JSON.stringify(res.body)}`);
}

export const powerRow = async (db: DbHandle, machineId: string) =>
  (await rawDb(db).select().from(machinePower).where(eq(machinePower.machineId, machineId)))[0];

/** The machine's power events, oldest first, as `action actor: reason`. */
export async function eventsOf(db: DbHandle, machineId: string): Promise<string[]> {
  const rows = await rawDb(db)
    .select()
    .from(machinePowerEvents)
    .where(eq(machinePowerEvents.machineId, machineId))
    .orderBy(asc(machinePowerEvents.at), asc(machinePowerEvents.id));
  return rows.map((row) => `${row.action} ${row.actor}: ${row.reason}`);
}
