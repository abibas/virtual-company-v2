import { ENROLLMENT_TOKEN_PATTERN } from '@mwc/shared/runner-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/api/client.ts';
import { parseArgs } from '../../src/args.ts';
import { machineCommand } from '../../src/machines/commands.ts';
import { portOf } from '../../src/machines/render.ts';
import { tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';
import { ORG_SERVER, type OrgWorld, orgWorld } from '../fixtures/org.ts';

let w: OrgWorld;
beforeAll(async () => {
  w = await orgWorld();
});
afterAll(() => w.t.close());

/** `mwc machine <argv>` with the owner's key in the environment unless `env` says otherwise. */
async function machine(argv: string[], env: Record<string, string> = {}, fetch: Fetch = w.fetch) {
  const c = capture({ env: { ...tempConfig().env, MWC_SERVER: ORG_SERVER, MWC_API_KEY: w.key, ...env } });
  const code = await machineCommand(parseArgs(['machine', ...argv]), c.io, { fetch });
  return { ...c, code };
}

describe('mwc machine enroll-token', () => {
  it('makes a one-time token and prints it with the install command for each kind of machine', async () => {
    const r = await machine(['enroll-token']);
    expect(r.code).toBe(0);
    expect(r.err()).toBe('');
    const token = r.out().split('\n')[2]?.trim() ?? '';
    expect(token).toMatch(ENROLLMENT_TOKEN_PATTERN);
    expect(r.out()).toMatch(
      /^An enrollment token for Acme \(acme\), good for one machine until \d{4}-\d\d-\d\dT/,
    );
    expect(r.out()).toContain(
      `  curl -fsSL ${ORG_SERVER}/api/runner/install.sh | sh -s -- --server ${ORG_SERVER} --token ${token}\n`,
    );
    // The devbox's command forwards the port of the API's own address (the test server's 9950) to the box.
    expect(r.out()).toContain(
      `  airia devbox ssh -- -R 127.0.0.1:9950:127.0.0.1:9950 'curl -fsSL http://127.0.0.1:9950/api/runner/install.sh | sh -s -- --server http://127.0.0.1:9950 --token ${token}'\n`,
    );
    expect(r.out()).toContain(`MWC_SERVER_URL=${ORG_SERVER} MWC_ENROLL_TOKEN=${token} docker compose`);
    // The token works: the runner's installer would trade it for a machine.
    const second = await machine(['enroll-token', '--company', 'acme']);
    expect(second.out().split('\n')[2]?.trim()).not.toBe(token);
  });

  it('takes the port of the server it talks to when /api/config does not answer', async () => {
    const noConfig: Fetch = async (url, init) =>
      url.endsWith('/api/config') ? new Response('', { status: 502 }) : w.fetch(url, init);
    const r = await machine(['enroll-token'], {}, noConfig);
    expect(r.code).toBe(0);
    expect(r.out()).toContain(`airia devbox ssh -- -R 127.0.0.1:${portOf(ORG_SERVER)}:127.0.0.1:`);
  });

  it("passes on the server's refusal for a member who may not make one", async () => {
    const r = await machine(['enroll-token'], { MWC_API_KEY: w.suspendedKey });
    expect(r.code).toBe(1);
    expect(r.err()).toMatch(/^mwc machine enroll-token: /);
    expect(r.out()).toBe('');
  });

  it('refuses another subcommand or an option without its value', async () => {
    const other = await machine(['list']);
    expect(other.code).toBe(2);
    expect(other.err()).toBe(
      'mwc machine: expected "enroll-token", got "list"\nusage: mwc machine enroll-token [--company <slug>] [--server <url>]\n',
    );
    expect((await machine(['enroll-token', '--company'])).err()).toMatch(
      /^mwc machine: --company needs a value/,
    );
  });
});
