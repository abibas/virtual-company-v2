import { captureLogger, fixedClock, TEST_NOW } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import { PINNED_TOOLS } from '../../../../../src/modules/machines/rules/runner.ts';
import {
  NPM_LATEST_TTL_MS,
  NPM_RETRY_MS,
  npmLatest,
  registryFetchFor,
} from '../../../../../src/modules/machines/service/tools/npm.ts';
import { CLAUDE_LATEST_URL, CODEX_LATEST_URL, FakeRegistry } from '../../../../fixtures/machines/registry.ts';

function world(timeoutMs?: number) {
  const registry = new FakeRegistry();
  const clock = fixedClock();
  const { logger, lines } = captureLogger();
  const npm = npmLatest({
    fetch: registry.fetch,
    clock,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { registry, clock, lines, npm };
}

const NPM = { claude: '2.1.330', codex: '0.167.0', source: 'npm', checkedAt: TEST_NOW };

describe("npm's latest Claude Code and Codex", () => {
  it('reads both packages’ latest with a deadline and no redirects, and keeps the answer', async () => {
    const { registry, npm } = world();
    registry.latest('2.1.330', '0.167.0');
    // Never read yet: the pins at once, the read started in the background.
    expect(npm.current()).toBe(PINNED_TOOLS);
    await npm.refresh();
    expect(npm.current()).toEqual(NPM);
    expect(registry.reads).toEqual([
      { url: CLAUDE_LATEST_URL, redirect: 'error', hasDeadline: true },
      { url: CODEX_LATEST_URL, redirect: 'error', hasDeadline: true },
    ]);
  });

  it('joins a read in progress instead of starting another', async () => {
    const { registry, npm } = world();
    registry.latest('2.1.330', '0.167.0');
    const first = npm.refresh();
    expect(npm.refresh()).toBe(first);
    npm.current();
    await first;
    expect(registry.reads).toHaveLength(2);
  });

  it('reads again in the background only once six hours passed, keeping the old answer until the new one', async () => {
    const { registry, clock, npm } = world();
    registry.latest('2.1.330', '0.167.0');
    await npm.refresh();
    clock.advance(NPM_LATEST_TTL_MS - 1);
    npm.current();
    expect(registry.reads).toHaveLength(2);
    clock.advance(1);
    registry.latest('2.1.331', '0.168.0');
    expect(npm.current()).toEqual(NPM);
    await npm.refresh();
    expect(registry.reads).toHaveLength(4);
    expect(npm.current()).toMatchObject({ claude: '2.1.331', codex: '0.168.0', source: 'npm' });
  });

  it('falls back to the pins when npm is down, keeps a known answer, and tries again ten minutes later', async () => {
    const { registry, clock, lines, npm } = world();
    registry.down = true;
    await npm.refresh();
    expect(npm.current()).toBe(PINNED_TOOLS);
    expect(
      lines.some((line) => line.msg === 'tools: npm could not be read; comparing with what was known'),
    ).toBe(true);
    registry.down = false;
    registry.latest('2.1.330', '0.167.0');
    clock.advance(NPM_RETRY_MS);
    npm.current();
    await npm.refresh();
    expect(npm.current()).toEqual({
      ...NPM,
      checkedAt: new Date(Date.parse(TEST_NOW) + NPM_RETRY_MS).toISOString(),
    });
    // One package failing keeps what was known.
    registry.answers.delete(CODEX_LATEST_URL);
    clock.advance(NPM_LATEST_TTL_MS);
    await npm.refresh();
    expect(npm.current()).toMatchObject({ claude: '2.1.330', codex: '0.167.0', source: 'npm' });
  });

  it('gives up on a read at its deadline, and refuses an answer without a version or too long', async () => {
    const slow = world(20);
    slow.registry.hang = true;
    await slow.npm.refresh();
    expect(slow.npm.current()).toBe(PINNED_TOOLS);
    for (const body of [
      '{"version":"latest"}',
      'null',
      'not json',
      `{"version":"1.0.0","x":"${'a'.repeat(1024 * 1024)}"}`,
    ]) {
      const { registry, npm } = world();
      registry.latest('2.1.330', '0.167.0');
      registry.answers.set(CODEX_LATEST_URL, { status: 200, body });
      await npm.refresh();
      expect(npm.current()).toBe(PINNED_TOOLS);
    }
  });

  it('is refused under NODE_ENV=test, and the platform’s fetch elsewhere', async () => {
    await expect(registryFetchFor({ NODE_ENV: 'test' })('https://registry.npmjs.org')).rejects.toThrow(
      'No network in tests',
    );
    const registry = new FakeRegistry().latest('1.0.0', '1.0.0');
    const answer = await registryFetchFor({ NODE_ENV: 'production' }, registry.fetch)(CLAUDE_LATEST_URL);
    expect(await answer.json()).toMatchObject({ version: '1.0.0' });
  });
});
