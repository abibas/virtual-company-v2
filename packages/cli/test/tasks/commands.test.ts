import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/args.ts';
import { flowCommand, taskCommand } from '../../src/tasks/commands.ts';
import { tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';
import { ORG_SERVER } from '../fixtures/org.ts';
import { type TasksWorld, tasksWorld } from '../fixtures/tasks.ts';

let w: TasksWorld;
beforeAll(async () => {
  w = await tasksWorld();
});
afterAll(() => w.t.close());

/** Runs one command with the owner's key in the environment unless `env` says otherwise. */
function runner(name: 'task' | 'flow', command: typeof taskCommand) {
  return async (argv: string[], env: Record<string, string> = {}) => {
    const c = capture({ env: { ...tempConfig().env, MWC_SERVER: ORG_SERVER, MWC_API_KEY: w.key, ...env } });
    const code = await command(parseArgs([name, ...argv]), c.io, { fetch: w.fetch });
    return { ...c, code };
  };
}
const task = runner('task', taskCommand);
const flow = runner('flow', flowCommand);

describe('mwc flow show', () => {
  it('prints the written form of the flow its Lead or its name names', async () => {
    for (const ref of ['slop-box', 'SLOP BOX', 'devbox delivery', w.flowId, w.principals.slop]) {
      const r = await flow(['show', ref]);
      expect([r.code, r.err()]).toEqual([0, '']);
      expect(r.out()).toBe(
        [
          'Flow: DEVBOX delivery · Lead: SLOP BOX',
          '',
          'Step          Kind       Who        Comes back again   Sends back to   Limit',
          'Develop       Work       SLOP BOX   Keep               —               —',
          'Code review   Check      Reviewer   Keep               Develop         1 → Lead',
          'Approve       Sign-off   Bob        —                  Develop         —',
          '→ Done',
          '',
        ].join('\n'),
      );
    }
  });

  it('prints the flow and its steps as JSON with --json', async () => {
    const r = await flow(['show', 'slop-box', '--json']);
    const body = JSON.parse(r.out());
    expect(body.company).toEqual(w.company);
    expect(body.result.steps.map((s: { name: string }) => s.name)).toEqual([
      'Develop',
      'Code review',
      'Approve',
    ]);
  });

  it('says which flows there are when the name matches none, and refuses a bad usage', async () => {
    const r = await flow(['show', 'nobody']);
    expect([r.code, r.err()]).toEqual([
      1,
      'mwc flow show: no flow for "nobody"; the company has DEVBOX delivery (Lead slop-box)\n',
    ]);
    expect((await flow(['show'])).code).toBe(2);
    expect((await flow(['draw', 'x'])).err()).toContain('expected one of show, got "draw"');
  });
});

describe('mwc task', () => {
  it('creates a task, queued or straight into a step by name', async () => {
    const queued = await task(['create', '--flow', 'slop-box', '--title', 'Fix the login']);
    expect([queued.code, queued.out()]).toEqual([0, 'T-1 created in DEVBOX delivery: queued\n']);
    const placed = await task([
      'create',
      '--flow',
      'DEVBOX delivery',
      '--title',
      'Ship it',
      '--step',
      'develop',
      '--priority',
      'high',
      '--description',
      'Do it now',
    ]);
    expect(placed.out()).toBe('T-2 created in DEVBOX delivery: active at Develop (waiting), round 1\n');
  });

  it('refuses a create without its options, with a bad priority, or a step the flow lacks', async () => {
    expect((await task(['create', '--flow', 'slop-box'])).code).toBe(2);
    expect(
      (await task(['create', '--flow', 'slop-box', '--title', 'x', '--priority', 'asap'])).err(),
    ).toContain('--priority must be one of low, normal, high, urgent');
    const r = await task(['create', '--flow', 'slop-box', '--title', 'x', '--step', 'Deploy']);
    expect([r.code, r.err()]).toEqual([
      1,
      'mwc task create: no step "Deploy" in DEVBOX delivery; its steps: Develop, Code review, Approve\n',
    ]);
    expect((await task(['create', '--flow', 'nobody', '--title', 'x'])).code).toBe(1);
  });

  it('lists the tasks as a table, by flow and state, or says there are none', async () => {
    const r = await task(['list']);
    expect(r.out()).toBe(
      [
        'KEY  STATE   STEP     STEP STATE  ROUND  WHO       PRIORITY  TITLE',
        'T-2  active  Develop  waiting     1      SLOP BOX  high      Ship it',
        'T-1  queued  -        -           -      -         normal    Fix the login',
        '',
      ].join('\n'),
    );
    expect((await task(['list', '--flow', 'slop-box', '--state', 'queued'])).out()).toContain('T-1  queued');
    expect((await task(['list', '--state', 'done'])).out()).toBe('No tasks done in Acme.\n');
    expect((await task(['list', '--state', 'open'])).code).toBe(2);
    expect(JSON.parse((await task(['list', '--json'])).out()).result).toHaveLength(2);
  });

  it('moves a task through its flow, and says where it stands after each move', async () => {
    const steps: [string[], string][] = [
      [['T-2', 'start'], 'T-2: now active at Develop (working), round 1'],
      [['T-2', 'hand_on'], 'T-2: now active at Code review (waiting), round 1'],
      [['T-2', 'send_back', '--reason', 'Tests fail'], 'T-2: now active at Develop (waiting), round 2'],
      [['T-2', 'hand_on'], 'T-2: now active at Code review (waiting), round 2'],
      [
        ['T-2', 'send_back', '--reason', 'Still failing'],
        'T-2: escalated to the Lead: Code review sent it back once already, its limit; this time: Still failing',
      ],
      [['T-2', 'route', '--to', 'code review'], 'T-2: now active at Code review (waiting), round 3'],
      [['T-2', 'pass'], 'T-2: now active at Approve (needs_person), round 1'],
      [['T-2', 'approve'], 'T-2: done'],
      [['T-1', 'cancel', '--reason', 'Duplicate'], 'T-1: cancelled'],
    ];
    for (const [argv, line] of steps) {
      const r = await task(['move', ...argv]);
      expect([r.code, r.out(), r.err()]).toEqual([0, `${line}\n`, '']);
    }
  });

  it('shows a task with its history, and passes refusals on', async () => {
    const r = await task(['show', 't-2']);
    const lines = r.out().split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'T-2 · Ship it',
      'Flow: DEVBOX delivery · Lead: SLOP BOX',
      'State: done · priority high',
      'Who: - · created by Olga',
      'You may: nothing',
    ]);
    expect(lines.slice(5, 9)).toEqual(['', 'Do it now', '', 'History:']);
    const history = lines.slice(9, -1).map((line) => line.slice(20));
    expect(history).toEqual([
      'created by Olga',
      'routed Develop by Olga',
      'entered Develop (round 1) by Olga',
      'started Develop by Olga',
      'handed on Develop → Code review by Olga',
      'entered Code review (round 1) by Olga',
      'sent back Code review → Develop by Olga: Tests fail',
      'entered Develop (round 2) by Olga',
      'handed on Develop → Code review by Olga',
      'entered Code review (round 2) by Olga',
      'escalated Code review → Develop by Olga: Still failing',
      'routed Code review → Code review by Olga',
      'entered Code review (round 3) by Olga',
      'passed Code review → Approve by Olga',
      'entered Approve (round 1) by Olga',
      'signed off Approve by Olga',
      'done Approve by Olga',
    ]);
    expect(lines[9]).toMatch(/^ {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}created by Olga$/);
    const refused = await task(['move', 'T-2', 'start']);
    expect([refused.code, refused.err()]).toEqual([1, 'mwc task move: The task is done, not at a step\n']);
    expect((await task(['show', 'T-99'])).err()).toBe('mwc task show: No such task in this company\n');
    expect((await task(['move', 'T-99', 'route', '--to', 'Develop'])).code).toBe(1);
    expect((await task(['move', 'T-2', 'route', '--to', 'Deploy'])).err()).toContain('no step "Deploy"');
  });

  it('shows an escalated task with its reason and where a retry sends it', async () => {
    await task(['create', '--flow', 'slop-box', '--title', 'Again', '--step', 'Code review']);
    await task(['move', 'T-3', 'send_back', '--reason', 'One']);
    await task(['move', 'T-3', 'hand_on']);
    await task(['move', 'T-3', 'send_back', '--reason', 'Two']);
    const lines = (await task(['show', 'T-3'])).out().split('\n');
    expect(lines.slice(2, 6)).toEqual([
      'State: escalated from Code review · priority normal',
      'Who: SLOP BOX · created by Olga',
      'Escalated: Code review sent it back once already, its limit; this time: Two (a retry sends it to Develop)',
      'You may: route, retry, cancel',
    ]);
  });

  it('refuses a bad usage before calling anything', async () => {
    for (const argv of [
      [],
      ['open'],
      ['show'],
      ['move', 'T-1'],
      ['list', '--flow'],
      ['list', '--title', 'x'],
    ]) {
      expect((await task(argv)).code).toBe(2);
    }
    expect((await task(['move', 'T-1', 'fly'])).err()).toContain('the action must be one of start, hand_on');
    expect((await task(['list'], { MWC_API_KEY: '' })).code).toBe(1);
  });
});
