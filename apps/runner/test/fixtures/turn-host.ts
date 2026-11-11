// A runner's turns in a process of their own, for the chaos test (S5.4): `node turn-host.ts <machine root> <scenario
// file> <turn id>` starts one turn on the real keeper and prints every frame it sends as a JSON line, until the test
// kills it with SIGKILL mid-turn, as `kill -9` kills a runner.
import { join } from 'node:path';
import {
  FAKE_HARNESS_BIN,
  FAKE_HARNESS_SCENARIO_ENV,
  FakeHarnessDriver,
  fakeTurnSpec,
} from '@mwc/harness-core/fake';
import { realTurns } from './real-turns.ts';

const [root, scenario, turnId] = process.argv.slice(2) as [string, string, string];
const driver = new FakeHarnessDriver({
  command: process.execPath,
  args: [FAKE_HARNESS_BIN],
  env: { [FAKE_HARNESS_SCENARIO_ENV]: scenario },
});
const machine = { root, cwd: join(root, 'agent'), stateDir: join(root, 'state'), driver: () => driver };
const world = realTurns(machine, driver, {
  online: () => true,
  onSend: (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
});
world.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd: machine.cwd }) });
