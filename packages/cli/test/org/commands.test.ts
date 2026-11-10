import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/api/client.ts';
import { parseArgs } from '../../src/args.ts';
import { saveLogin } from '../../src/credentials.ts';
import { agentsCommand, orgCommand } from '../../src/org/commands.ts';
import { ACME, meBody, noFetch, RUNNER_KEY, tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';
import { ORG_SERVER, type OrgWorld, orgWorld } from '../fixtures/org.ts';

let w: OrgWorld;
beforeAll(async () => {
  w = await orgWorld();
});
afterAll(() => w.t.close());

/** Runs one command with the owner's key in the environment unless `env` says otherwise. */
function runner(name: 'org' | 'agents', command: typeof orgCommand) {
  return async (argv: string[], env: Record<string, string> = {}, fetch: Fetch = w.fetch) => {
    const c = capture({ env: { ...tempConfig().env, MWC_SERVER: ORG_SERVER, MWC_API_KEY: w.key, ...env } });
    const code = await command(parseArgs([name, ...argv]), c.io, { fetch });
    return { ...c, code };
  };
}
/** `mwc org <argv>`. */
const org = runner('org', orgCommand);
/** `mwc agents <argv>`. */
const agents = runner('agents', agentsCommand);

const TREE =
  'Acme (acme): 3 people, 3 agents\n' +
  'Olga · CEO · owner\n' +
  '├── Bob · CTO · admin\n' +
  '│   └── ann@acme.test · viewer\n' +
  '└── ◆ SLOP BOX · Coder · active · claude-opus-5-5/xhigh\n' +
  '    └── ◆ Reviewer · Code reviewer · paused · default/default\n' +
  '◆ Lost · Tester · active · no profile [orphan]\n';

/** A fetch whose `GET /api/me` lists Acme and another company, as a login that reaches several would see it. */
const twoCompanies: Fetch = async (url, init) => {
  if (!url.endsWith('/api/me')) return w.fetch(url, init);
  const acme = { ...ACME, companyId: w.company.id };
  const body = meBody(acme, [acme, { ...ACME, companyId: 'c2', slug: 'beta', name: 'Beta' }]);
  return Response.json(body);
};

describe('mwc org tree', () => {
  it('prints the chart as an indented tree: people, agents with ◆, orphans marked', async () => {
    const r = await org(['tree']);
    expect(r.code).toBe(0);
    expect(r.out()).toBe(TREE);
    expect(r.err()).toBe('');
  });

  it('prints the company, the nodes and the tree as JSON with --json', async () => {
    const r = await org(['tree', '--json']);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out());
    expect(body.company).toEqual(w.company);
    expect(body.nodes).toHaveLength(6);
    expect(body.nodes[0]).toEqual({
      principalId: w.principals.olga,
      reportsTo: null,
      title: 'CEO',
      kind: 'person',
      person: {
        userId: expect.any(String),
        displayName: 'Olga',
        email: 'olga@acme.test',
        imageUrl: null,
        role: 'owner',
      },
    });
    expect(
      body.tree.map((top: { principalId: string; orphan: boolean }) => [top.principalId, top.orphan]),
    ).toEqual([
      [w.principals.olga, false],
      [w.principals.lost, true],
    ]);
    expect(r.out()).toMatch(/^\{\n {2}"company"/);
  });

  it('uses the saved login and its company, or the one --server names, when there is no key in the environment', async () => {
    const config = tempConfig();
    saveLogin(config.path, { server: ORG_SERVER, companyId: w.company.id, companySlug: 'acme', key: w.key });
    saveLogin(config.path, {
      server: 'http://other.test',
      companyId: 'x',
      companySlug: 'x',
      key: RUNNER_KEY,
    });
    const c = capture({ env: config.env });
    expect(
      await orgCommand(parseArgs(['org', 'tree', '--server', ORG_SERVER]), c.io, { fetch: w.fetch }),
    ).toBe(0);
    expect(c.out()).toBe(TREE);
  });

  it('takes --company by slug or id, and refuses one the key cannot reach with the slugs it can', async () => {
    expect((await org(['tree', '--company', 'acme'])).out()).toBe(TREE);
    expect((await org(['tree', '--company', w.company.id])).out()).toBe(TREE);
    const other = await org(['tree', '--company', 'globex']);
    expect(other.code).toBe(1);
    expect(other.err()).toBe('mwc org tree: no company "globex" for this key; it can reach acme\n');
    expect(other.out()).toBe('');
  });

  it('asks for --company when the login reaches several companies, and takes the one named', async () => {
    const several = await org(['tree'], {}, twoCompanies);
    expect(several.code).toBe(1);
    expect(several.err()).toBe(
      'mwc org tree: this key reaches several companies (acme, beta); choose one with --company <slug>\n',
    );
    const named = await org(['tree', '--company', 'acme'], {}, twoCompanies);
    expect(named.code).toBe(0);
    expect(named.out()).toBe(TREE);
  });

  it('exits 1 with the server message when the key is refused or the company refuses the member', async () => {
    const bad = await org(['tree'], { MWC_API_KEY: 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u' });
    expect(bad.code).toBe(1);
    expect(bad.err()).toMatch(
      /^mwc org tree: http:\/\/mwc\.test refused the key \(.+\)\. Make a new key and run mwc login again\.\n$/,
    );
    const suspended = await org(['tree'], { MWC_API_KEY: w.suspendedKey });
    expect(suspended.code).toBe(1);
    expect(suspended.err()).toBe('mwc org tree: Company not found\n');
  });

  it('exits 1 when not logged in, the file is broken, the key is not personal or the server is away', async () => {
    const config = tempConfig();
    const nobody = capture({ env: config.env });
    expect(await orgCommand(parseArgs(['org', 'tree']), nobody.io, { fetch: noFetch })).toBe(1);
    expect(nobody.err()).toBe(
      'mwc org tree: not logged in. Run mwc login --server <url> --company <id|slug>, or set MWC_SERVER and ' +
        'MWC_API_KEY.\n',
    );
    mkdirSync(config.dir, { recursive: true });
    writeFileSync(config.path, 'not json');
    const broken = capture({ env: config.env });
    expect(await orgCommand(parseArgs(['org', 'tree']), broken.io, { fetch: noFetch })).toBe(1);
    expect(broken.err()).toMatch(/^mwc org tree: .*is not valid JSON/);
    const runner = await org(['tree'], { MWC_API_KEY: RUNNER_KEY }, noFetch);
    expect(runner.err()).toBe(
      'mwc org tree: the key from MWC_API_KEY is not a personal API key (mwc_pk_ and 32 letters or digits)\n',
    );
    const away = await org(['tree'], {}, () => Promise.reject(new Error('ECONNREFUSED')));
    expect(away.code).toBe(1);
    expect(away.err()).toBe(`mwc org tree: cannot reach ${ORG_SERVER}: ECONNREFUSED\n`);
  });

  it('exits 1 with the server message when the chart call fails after the key was accepted', async () => {
    const failing: Fetch = async (url, init) =>
      url.endsWith('/org/chart')
        ? Response.json(
            { error: { code: 'internal', message: 'Something broke', requestId: 'r' } },
            { status: 500 },
          )
        : w.fetch(url, init);
    const r = await org(['tree'], {}, failing);
    expect(r.code).toBe(1);
    expect(r.err()).toBe('mwc org tree: Something broke\n');
  });

  it('refuses a missing or unknown subcommand, extra words and options without a value (exit 2)', async () => {
    for (const [argv, why] of [
      [[], 'expected "tree"'],
      [['list'], 'expected "tree", got "list"'],
      [['tree', 'now'], 'expected "tree", got "tree now"'],
      [['tree', '--company'], '--company needs a value'],
      [['tree', '--server'], '--server needs a value'],
    ] as const) {
      const r = await org([...argv], {}, noFetch);
      expect(r.code).toBe(2);
      expect(r.err()).toBe(
        `mwc org: ${why}\nusage: mwc org tree [--company <slug>] [--json] [--server <url>]\n`,
      );
    }
  });
});

// Each agent's model and effort are its access profile's: `default` for the provider's, `no profile` without one.
const HEAD = 'NAME      SLUG      ROLE           STATUS  MODEL            EFFORT   REPORTS TO\n';
const SLOP = 'SLOP BOX  slop-box  Coder          active  claude-opus-5-5  xhigh    Olga\n';
const REVIEWER = 'Reviewer  reviewer  Code reviewer  paused  default          default  SLOP BOX\n';
const LOST = 'Lost      lost      Tester         active  no profile       -        (off the chart)\n';

describe('mwc agents list', () => {
  it('prints the active and paused agents as an aligned table, with whom each reports to by name', async () => {
    const r = await agents(['list']);
    expect(r.code).toBe(0);
    expect(r.out()).toBe(HEAD + SLOP + REVIEWER + LOST);
    expect(r.err()).toBe('');
  });

  it('lists one status, or all of them, with --status', async () => {
    const all = await agents(['list', '--status', 'all']);
    expect(all.out()).toBe(
      'NAME      SLUG      ROLE           STATUS    MODEL            EFFORT   REPORTS TO\n' +
        'SLOP BOX  slop-box  Coder          active    claude-opus-5-5  xhigh    Olga\n' +
        'Reviewer  reviewer  Code reviewer  paused    default          default  SLOP BOX\n' +
        'Old QA    old-qa    QA             archived  no profile       -        -\n' +
        'Lost      lost      Tester         active    no profile       -        (off the chart)\n',
    );
    const archived = await agents(['list', '--status', 'archived']);
    expect(archived.out()).toBe(
      'NAME    SLUG    ROLE  STATUS    MODEL       EFFORT  REPORTS TO\n' +
        'Old QA  old-qa  QA    archived  no profile  -       -\n',
    );
    const paused = await agents(['list', '--status=paused']);
    expect(paused.out()).toBe(
      'NAME      SLUG      ROLE           STATUS  MODEL    EFFORT   REPORTS TO\n' +
        'Reviewer  reviewer  Code reviewer  paused  default  default  SLOP BOX\n',
    );
  });

  it('prints the company and the agents with reportsToName as JSON with --json', async () => {
    const r = await agents(['list', '--json', '--status', 'all']);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out());
    expect(body.company).toEqual(w.company);
    expect(
      body.agents.map((a: { slug: string; reportsToName: string | null }) => [a.slug, a.reportsToName]),
    ).toEqual([
      ['slop-box', 'Olga'],
      ['reviewer', 'SLOP BOX'],
      ['old-qa', null],
      ['lost', null],
    ]);
    expect(body.agents[0]).toMatchObject({
      name: 'SLOP BOX',
      roleTitle: 'Coder',
      status: 'active',
      harness: 'claude_code',
      runsWith: { model: 'claude-opus-5-5', effort: 'xhigh', provider: 'claude' },
      reportsTo: w.principals.olga,
      maxConcurrentRuns: 1,
    });
  });

  it('says so when a company has no agents to show', async () => {
    const r = await agents(['list'], { MWC_API_KEY: w.globexKey });
    expect(r.code).toBe(0);
    expect(r.out()).toBe('No active or paused agents in Globex (globex).\n');
  });

  it('refuses a status that is not one, before calling anything (exit 2)', async () => {
    const r = await agents(['list', '--status', 'retired'], {}, noFetch);
    expect(r.code).toBe(2);
    expect(r.err()).toBe(
      'mwc agents list: --status must be one of active, paused, archived, all, not "retired"\n',
    );
  });

  it('refuses a missing subcommand and options without a value (exit 2)', async () => {
    const usage =
      'usage: mwc agents list [--company <slug>] [--status active|paused|archived|all] [--json] [--server <url>]\n';
    for (const [argv, why] of [
      [[], 'expected "list"'],
      [['list', '--status'], '--status needs a value'],
      [['list', '--company'], '--company needs a value'],
    ] as const) {
      const r = await agents([...argv], {}, noFetch);
      expect(r.code).toBe(2);
      expect(r.err()).toBe(`mwc agents: ${why}\n${usage}`);
    }
  });

  it('exits 1 with the server message when the agents or the chart call fails', async () => {
    const suspended = await agents(['list'], { MWC_API_KEY: w.suspendedKey });
    expect(suspended.code).toBe(1);
    expect(suspended.err()).toBe('mwc agents list: Company not found\n');
    const unknown = await agents(['list', '--company', 'globex']);
    expect(unknown.code).toBe(1);
    expect(unknown.err()).toBe('mwc agents list: no company "globex" for this key; it can reach acme\n');
    const noChart: Fetch = async (url, init) =>
      url.endsWith('/org/chart') ? new Response('<html>busy</html>', { status: 503 }) : w.fetch(url, init);
    const r = await agents(['list'], {}, noChart);
    expect(r.code).toBe(1);
    expect(r.err()).toBe('mwc agents list: the server answered 503\n');
  });
});
