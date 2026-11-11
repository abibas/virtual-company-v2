import { seedApiKey } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/args.ts';
import { inboxCommand } from '../../src/inbox/commands.ts';
import { taskCommand } from '../../src/tasks/commands.ts';
import { tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';
import { ORG_SERVER } from '../fixtures/org.ts';
import { type TasksWorld, tasksWorld } from '../fixtures/tasks.ts';

let w: TasksWorld;
let bobKey: string;
beforeAll(async () => {
  w = await tasksWorld();
  bobKey = (await seedApiKey(w.t.db, w.company.id, w.principals.bob)).key;
});
afterAll(() => w.t.close());

/** Runs one command with Olga's key (the owner's) unless `key` says otherwise. */
function runner(name: 'inbox' | 'task', command: typeof inboxCommand) {
  return async (argv: string[], key = w.key) => {
    const c = capture({ env: { ...tempConfig().env, MWC_SERVER: ORG_SERVER, MWC_API_KEY: key } });
    const code = await command(parseArgs([name, ...argv]), c.io, { fetch: w.fetch });
    return { ...c, code };
  };
}
const inbox = runner('inbox', inboxCommand);
const task = runner('task', taskCommand);

/** The table's rows split on its column gaps, without the header. */
const rowsOf = (out: string) =>
  out
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((line) => line.split(/ {2,}/));

/**
 * The tasks world's flow, led by SLOP BOX under Olga: Develop (SLOP BOX), Code review (Reviewer, back to Develop, 1) and
 * Approve (Bob's sign-off). Olga leads the team; Bob signs off.
 */
describe('mwc inbox', () => {
  it('says nothing needs you while nothing does, in the company or across them', async () => {
    expect((await inbox(['list'], bobKey)).out()).toBe('Nothing needs you in Acme.\n');
    expect((await inbox(['list', '--all'], bobKey)).out()).toBe('Nothing needs you.\n');
    expect((await inbox(['count'], bobKey)).out()).toBe('0\n');
  });

  it('lists a Sign-off for its person, counts it, and sends it back or approves it', async () => {
    await task(['create', '--flow', 'slop-box', '--title', 'Ship it', '--step', 'approve']);
    const listed = await inbox(['list'], bobKey);
    expect(listed.code).toBe(0);
    expect(listed.out().split('\n')[0]?.split(/ {2,}/)).toEqual([
      'KIND',
      'KEY',
      'TITLE',
      'WHERE',
      'FROM',
      'SINCE',
      'YOU MAY',
    ]);
    const [row] = rowsOf(listed.out());
    expect(row?.slice(0, 5)).toEqual(['Sign-off', 'T-1', 'Ship it', 'DEVBOX delivery · Approve', 'Olga']);
    expect(row?.[5]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    // Bob is an admin too, so he may also route and cancel it.
    expect(row?.[6]).toBe('approve, send_back, route, cancel');
    expect((await inbox(['count'], bobKey)).out()).toBe('1\n');
    const json = JSON.parse((await inbox(['count', '--all', '--json'], bobKey)).out());
    expect(json.company).toEqual(w.company);
    expect(json.result).toMatchObject({ count: 1, companies: [{ slug: 'acme', count: 1 }] });

    const back = await inbox(['send-back', 'T-1', '--reason', 'The copy is wrong'], bobKey);
    expect([back.code, back.out()]).toEqual([0, 'T-1: now active at Develop (waiting), round 1\n']);
    expect((await inbox(['count'], bobKey)).out()).toBe('0\n');

    await task(['create', '--flow', 'slop-box', '--title', 'Ship that', '--step', 'approve']);
    const approved = await inbox(['approve', 'T-2'], bobKey);
    expect([approved.code, approved.out()]).toEqual([0, 'T-2: done\n']);
  });

  it("lists a team's stuck task for its Lead's people across their companies, with the company", async () => {
    await task(['create', '--flow', 'slop-box', '--title', 'Build it', '--step', 'develop']);
    await task(['move', 'T-3', 'start']);
    const listed = await inbox(['list', '--all']);
    const [row, ...rest] = rowsOf(listed.out());
    expect(rest).toEqual([]);
    expect(row?.slice(0, 5)).toEqual(['Blocked', 'T-3', 'Build it', 'DEVBOX delivery · Develop', 'SLOP BOX']);
    expect(row?.at(-1)).toBe('acme');
    const json = JSON.parse((await inbox(['list', '--json'])).out());
    expect(json.result.items[0]).toMatchObject({ kind: 'blocked', link: 'tasks/T-3' });
  });

  it("says the server's refusal, and refuses a bad usage", async () => {
    const refused = await inbox(['approve', 'T-3']);
    expect([refused.code, refused.err()]).toEqual([
      1,
      'mwc inbox approve: approve is not a move of "Develop", a work step\n',
    ]);
    expect((await inbox(['approve', 'T-99'])).code).toBe(1);
    expect((await inbox(['count'], 'mwc_pk_unknown')).code).toBe(1);
    for (const [argv, message] of [
      [['frob'], 'expected one of list, count, approve, send-back, got "frob"'],
      [[], 'expected one of list, count, approve, send-back'],
      [['approve'], 'approve takes 1 more word'],
      [['list', 'T-1'], 'list takes no more words'],
      [['send-back', 'T-3'], '--reason is needed'],
      [['send-back', 'T-3', '--reason'], '--reason needs a value'],
      [['list', '--state', 'x'], 'list does not take --state'],
      [['approve', 'T-3', '--all'], 'approve does not take --all'],
    ] as const) {
      const r = await inbox([...argv]);
      expect([r.code, r.err()]).toEqual([2, expect.stringContaining(message)]);
    }
  });
});
