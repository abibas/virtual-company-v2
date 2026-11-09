// The fake harness binary for the runner's tests (docs/harness.md, "Tests"): `node scripts/fake-harness.ts [args]`
// plays the scenario file FAKE_HARNESS_SCENARIO names. Its logic is runFakeHarness (src/scenario.ts), tested in-process.
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { runFakeHarness } from '../src/scenario.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

process.exitCode = await runFakeHarness({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  readStdin,
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, { mode: 0o600 }),
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
  sleep: async (ms) => {
    await sleep(ms);
  },
});
