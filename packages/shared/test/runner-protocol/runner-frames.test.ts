import { describe, expect, it } from 'vitest';
import {
  AttentionCreate,
  CmdAck,
  HoldState,
  JobAccept,
  JobDecline,
  PowerResult,
  RunEvents,
  RunnerFrame,
  RunnerHeartbeat,
  RunnerHello,
  RunnerResync,
} from '../../src/runner-protocol/runner-frames.ts';
import { IDS, RUNNER_EXAMPLES, SAMPLE } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

const ids = (count: number) => Array.from({ length: count }, () => IDS.run);

describe('runner.hello', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];
  const caps = hello.caps;

  it('takes any protocol from 1 (the server decides), no harness, no slot and no power', () => {
    expect(issuesOf(RunnerHello, { ...hello, protocol: 2 })).toEqual([]);
    expect(
      issuesOf(RunnerHello, { ...hello, caps: { ...caps, harnesses: [], slots: 0, power: [] } }),
    ).toEqual([]);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, hold: 'devbox_keepalive' } })).toEqual([]);
  });

  it("takes Claude Code's version, null without it, or nothing (the machine keeps its version on record)", () => {
    expect(issuesOf(RunnerHello, { ...hello, claudeVersion: '2.1.3 (Claude Code)' })).toEqual([]);
    expect(issuesOf(RunnerHello, { ...hello, claudeVersion: null })).toEqual([]);
    expect(issuesOf(RunnerHello, without(hello, 'claudeVersion'))).toEqual([]);
    expect(issuesOf(RunnerHello, { ...hello, claudeVersion: '' })).toEqual(['claudeVersion']);
    expect(issuesOf(RunnerHello, { ...hello, claudeVersion: 'x'.repeat(101) })).toEqual(['claudeVersion']);
  });

  it('refuses a bad protocol, version or caps', () => {
    expect(issuesOf(RunnerHello, { ...hello, protocol: 0 })).toEqual(['protocol']);
    expect(issuesOf(RunnerHello, { ...hello, protocol: 1.5 })).toEqual(['protocol']);
    expect(issuesOf(RunnerHello, { ...hello, version: 'v0.5' })).toEqual(['version']);
    expect(issuesOf(RunnerHello, without(hello, 'caps'))).toEqual(['caps']);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, harnesses: ['cursor'] } })).toEqual([
      'caps.harnesses.0',
    ]);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, slots: -1 } })).toEqual(['caps.slots']);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, slots: 65 } })).toEqual(['caps.slots']);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, hold: 'sleep' } })).toEqual(['caps.hold']);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...caps, power: ['none'] } })).toEqual(['caps.power.0']);
  });
});

describe('runner.heartbeat', () => {
  const beat = RUNNER_EXAMPLES['runner.heartbeat'];

  it('takes a heartbeat without a sample and with up to 64 live runs', () => {
    expect(issuesOf(RunnerHeartbeat, without(beat, 'sample'))).toEqual([]);
    expect(issuesOf(RunnerHeartbeat, { ...beat, liveRuns: ids(64) })).toEqual([]);
  });

  it('refuses bad numbers, run ids and samples', () => {
    expect(issuesOf(RunnerHeartbeat, { ...beat, awakeMs: -1 })).toEqual(['awakeMs']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, load1: -0.1 })).toEqual(['load1']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, liveRuns: ['run-1'] })).toEqual(['liveRuns.0']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, liveRuns: ids(65) })).toEqual(['liveRuns']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, backlog: 1.5 })).toEqual(['backlog']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, now: -1 })).toEqual(['now']);
    expect(issuesOf(RunnerHeartbeat, { ...beat, sample: { ...SAMPLE, cpuPct: 101 } })).toEqual([
      'sample.cpuPct',
    ]);
  });
});

describe('runner.resync', () => {
  const resync = RUNNER_EXAMPLES['runner.resync'];
  const run = resync.runs[0] as (typeof resync.runs)[number];

  it('takes no runs, and a gone run without an exit code', () => {
    expect(issuesOf(RunnerResync, { ...resync, runs: [] })).toEqual([]);
    expect(issuesOf(RunnerResync, { ...resync, runs: [{ ...run, state: 'gone', lastSeq: 0 }] })).toEqual([]);
  });

  it('refuses an unknown state, a fractional exit code, a negative seq and over 1000 runs', () => {
    expect(issuesOf(RunnerResync, { ...resync, runs: [{ ...run, state: 'lost' }] })).toEqual([
      'runs.0.state',
    ]);
    expect(issuesOf(RunnerResync, { ...resync, runs: [{ ...run, exitCode: 1.5 }] })).toEqual([
      'runs.0.exitCode',
    ]);
    expect(issuesOf(RunnerResync, { ...resync, runs: [without(run, 'exitCode')] })).toEqual([
      'runs.0.exitCode',
    ]);
    expect(issuesOf(RunnerResync, { ...resync, runs: [{ ...run, lastSeq: -1 }] })).toEqual([
      'runs.0.lastSeq',
    ]);
    expect(issuesOf(RunnerResync, { ...resync, runs: Array.from({ length: 1001 }, () => run) })).toEqual([
      'runs',
    ]);
  });
});

describe('job.accept and job.decline', () => {
  it('take the offer and run ids, and a reason for a decline', () => {
    expect(issuesOf(JobAccept, { ...RUNNER_EXAMPLES['job.accept'], id: 'offer-1' })).toEqual(['id']);
    expect(issuesOf(JobAccept, without(RUNNER_EXAMPLES['job.accept'], 'runId'))).toEqual(['runId']);
    const decline = RUNNER_EXAMPLES['job.decline'];
    expect(issuesOf(JobDecline, { ...decline, reason: '' })).toEqual(['reason']);
    expect(issuesOf(JobDecline, { ...decline, reason: 'x'.repeat(501) })).toEqual(['reason']);
  });
});

describe('run.events', () => {
  const batch = RUNNER_EXAMPLES['run.events'];
  const event = batch.events[0] as (typeof batch.events)[number];

  it('takes 1 to 100 events', () => {
    expect(issuesOf(RunEvents, { ...batch, events: Array.from({ length: 100 }, () => event) })).toEqual([]);
    expect(issuesOf(RunEvents, { ...batch, events: [] })).toEqual(['events']);
    expect(issuesOf(RunEvents, { ...batch, events: Array.from({ length: 101 }, () => event) })).toEqual([
      'events',
    ]);
  });

  it('refuses a seq below 1, a kind that is not lower-case words, and data that is not an object', () => {
    expect(issuesOf(RunEvents, { ...batch, events: [{ ...event, seq: 0 }] })).toEqual(['events.0.seq']);
    for (const kind of ['Text', '', 'tool use', `a${'b'.repeat(64)}`]) {
      expect(issuesOf(RunEvents, { ...batch, events: [{ ...event, kind }] })).toEqual(['events.0.kind']);
    }
    expect(issuesOf(RunEvents, { ...batch, events: [{ ...event, kind: 'tool_result.v2' }] })).toEqual([]);
    expect(issuesOf(RunEvents, { ...batch, events: [{ ...event, data: ['x'] }] })).toEqual(['events.0.data']);
    expect(issuesOf(RunEvents, { ...batch, events: [without(event, 'at')] })).toEqual(['events.0.at']);
  });
});

describe('attention.create', () => {
  const item = RUNNER_EXAMPLES['attention.create'];
  const option = item.options[0];

  it('takes every kind a run raises, with or without options', () => {
    for (const kind of ['permission', 'question', 'blocked', 'review', 'failed']) {
      expect(issuesOf(AttentionCreate, { ...item, kind, options: [] })).toEqual([]);
    }
    expect(issuesOf(AttentionCreate, { ...item, wait: 'next_turn' })).toEqual([]);
  });

  it('refuses the server-only kind, an unknown wait, an empty prompt and bad options', () => {
    expect(issuesOf(AttentionCreate, { ...item, kind: 'done' })).toEqual(['kind']);
    expect(issuesOf(AttentionCreate, { ...item, wait: 'later' })).toEqual(['wait']);
    expect(issuesOf(AttentionCreate, { ...item, prompt: '' })).toEqual(['prompt']);
    expect(issuesOf(AttentionCreate, { ...item, options: Array.from({ length: 33 }, () => option) })).toEqual(
      ['options'],
    );
    expect(issuesOf(AttentionCreate, { ...item, options: [{ ...option, label: '' }] })).toEqual([
      'options.0.label',
    ]);
    expect(issuesOf(AttentionCreate, { ...item, options: [{ ...option, id: 'x'.repeat(65) }] })).toEqual([
      'options.0.id',
    ]);
  });
});

describe('cmd.ack', () => {
  const ack = RUNNER_EXAMPLES['cmd.ack'];

  it('takes a failure with its reason, and refuses a missing ok or an empty reason', () => {
    expect(issuesOf(CmdAck, { ...ack, ok: false, error: 'no such run' })).toEqual([]);
    expect(issuesOf(CmdAck, without(ack, 'ok'))).toEqual(['ok']);
    expect(issuesOf(CmdAck, { ...ack, error: '' })).toEqual(['error']);
    expect(issuesOf(CmdAck, { ...ack, error: 'x'.repeat(2001) })).toEqual(['error']);
  });
});

describe('hold.state', () => {
  const state = RUNNER_EXAMPLES['hold.state'];

  it('takes no hold (null) from either source, and refuses another source', () => {
    expect(issuesOf(HoldState, { ...state, until: null })).toEqual([]);
    expect(issuesOf(HoldState, { ...state, until: null, source: 'live_runs' })).toEqual([]);
    expect(issuesOf(HoldState, { ...state, source: 'auto' })).toEqual(['source']);
    expect(issuesOf(HoldState, without(state, 'until'))).toEqual(['until']);
  });
});

describe('power.result', () => {
  const result = RUNNER_EXAMPLES['power.result'];

  it('takes a bare failure, and refuses a provider word for a status and metadata that is not an object', () => {
    expect(
      issuesOf(PowerResult, { type: 'power.result', cmdId: IDS.cmd, ok: false, error: 'gcloud: 403' }),
    ).toEqual([]);
    expect(issuesOf(PowerResult, { ...result, status: 'RUNNING' })).toEqual(['status']);
    expect(issuesOf(PowerResult, { ...result, metadata: 'zone=x' })).toEqual(['metadata']);
  });
});

describe('RunnerFrame', () => {
  it('tells the frames apart by type and refuses an unknown one', () => {
    expect(RunnerFrame.parse(RUNNER_EXAMPLES['hold.state']).type).toBe('hold.state');
    expect(issuesOf(RunnerFrame, { type: 'runner.bye' })).toEqual(['type']);
  });
});
