/**
 * The chats' tests of a stopped machine: the chats' world with the waits' timers fired by hand, and a company whose
 * agent sits on its Airia devbox (stopped, its runner not connected) powered by This Mac's runner (a controller over a
 * `FakePowerDriver`), with an access profile and a chat. Never a real box: the driver is the fake.
 */
import type { FakePowerDriver } from '@mwc/machines-core/fake';
import type { MachinePowerPolicyInput } from '@mwc/shared/machines';
import type { FakeRunner } from '@mwc/testkit/runner';
import type { ChatView } from '../../../src/modules/chats/schemas.ts';
import { boxDriver, connectController, eventsOf, macAndBox, putPolicy } from '../machines/power.ts';
import { type MembersCompany, membersCompany } from '../members/members.ts';
import { addSubscription, makeAgent, putProfile, seedProfile } from '../org.ts';
import { type ManualTimers, manualTimers } from '../platform/jobs.ts';
import { BOTH_HARNESSES, beginChat, type ChatsWorld, chatsWorld, eventually, place } from './world.ts';

export interface BoxWorld extends ChatsWorld {
  /** The waits' timers: `fire()` ends the oldest wait's 10 minutes. */
  readonly waits: ManualTimers;
}

export async function boxWorld(): Promise<BoxWorld> {
  const waits = manualTimers();
  const w = await chatsWorld({}, { machineWaitTimers: waits.timers });
  return { ...w, waits };
}

export interface BoxScene {
  readonly company: MembersCompany;
  readonly box: { readonly machineId: string; readonly runnerKey: string };
  readonly driver: FakePowerDriver;
  readonly agentId: string;
  readonly chat: ChatView;
}

/** The company, This Mac powering its stopped devbox with `policy`, the agent SLOP BOX on the box, and a chat. */
export async function boxScene(w: ChatsWorld, policy: MachinePowerPolicyInput = {}): Promise<BoxScene> {
  const company = await membersCompany(w);
  const { mac, box } = await macAndBox(w, company);
  const driver = boxDriver();
  await connectController(w, mac.runnerKey, driver);
  await putPolicy(w, company, box.machineId, policy);
  const agent = await makeAgent(w, company, company.owner);
  await place(w, company, agent.id, { machineId: box.machineId });
  const credential = await addSubscription(w, w.keyring, company.owner.userId, 'claude_setup_token');
  const profile = await seedProfile(w.t.db, company.owner.userId, {
    credentialId: credential.id,
    model: 'claude-opus-5-5',
  });
  await putProfile(w.t.db, company.companyId, agent.id, profile.id);
  const chat = await beginChat(w, company, agent.id);
  return { company, box, driver, agentId: agent.id, chat };
}

/** The box's runner connects, with both CLIs. */
export const boxUp = (w: ChatsWorld, s: Pick<BoxScene, 'box'>): Promise<FakeRunner> =>
  w.connect(s.box.runnerKey, { caps: BOTH_HARNESSES });

/** Waits until the box's power log has an entry starting with `prefix`. */
export async function logged(w: ChatsWorld, machineId: string, prefix: string): Promise<string[]> {
  await eventually(`the power log says ${prefix}`, async () =>
    (await eventsOf(w.t.db, machineId)).some((line) => line.startsWith(prefix)),
  );
  return eventsOf(w.t.db, machineId);
}
