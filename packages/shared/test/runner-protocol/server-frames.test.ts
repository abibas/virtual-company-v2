import { describe, expect, it } from 'vitest';
import {
  AttentionResolved,
  JobOffer,
  KeyRotate,
  MachineHold,
  PowerCommand,
  RunAck,
  RunInput,
  RunnerDrain,
  RunStart,
  RunStop,
  ServerFrame,
  ServerHello,
  TUNNELS_MAX,
  TunnelSet,
} from '../../src/runner-protocol/server-frames.ts';
import { IDS, SERVER_EXAMPLES } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

describe('server.hello', () => {
  const hello = SERVER_EXAMPLES['server.hello'];

  it('takes the protocol, the lowest runner version and the machine', () => {
    expect(issuesOf(ServerHello, { ...hello, minRunnerVersion: '1.0.0-rc.1' })).toEqual([]);
    expect(issuesOf(ServerHello, { ...hello, protocol: 0 })).toEqual(['protocol']);
    expect(issuesOf(ServerHello, { ...hello, minRunnerVersion: 'latest' })).toEqual(['minRunnerVersion']);
    expect(issuesOf(ServerHello, { ...hello, machineId: 'mac' })).toEqual(['machineId']);
  });
});

describe('job.offer and run.start', () => {
  it('refuse an offer without an agent or with a text expiry, and a start without its spec', () => {
    const offer = SERVER_EXAMPLES['job.offer'];
    expect(issuesOf(JobOffer, without(offer, 'agentId'))).toEqual(['agentId']);
    expect(issuesOf(JobOffer, { ...offer, expiresAt: '2026-11-06T12:00:30Z' })).toEqual(['expiresAt']);
    expect(issuesOf(RunStart, without(SERVER_EXAMPLES['run.start'], 'spec'))).toEqual(['spec']);
    expect(issuesOf(RunStart, { ...SERVER_EXAMPLES['run.start'], cmdId: 1 })).toEqual(['cmdId']);
  });
});

describe('run.input', () => {
  it('refuses an empty message', () => {
    expect(issuesOf(RunInput, { ...SERVER_EXAMPLES['run.input'], text: '' })).toEqual(['text']);
    expect(issuesOf(RunInput, without(SERVER_EXAMPLES['run.input'], 'inputId'))).toEqual(['inputId']);
  });
});

describe('attention.resolved', () => {
  const resolved = SERVER_EXAMPLES['attention.resolved'];

  it('takes chosen options, words or a permission decision', () => {
    expect(issuesOf(AttentionResolved, { ...resolved, answer: { text: 'Use main' } })).toEqual([]);
    for (const decision of ['allow', 'deny', 'deny_stop']) {
      expect(issuesOf(AttentionResolved, { ...resolved, answer: { decision } })).toEqual([]);
    }
  });

  it('refuses an empty answer, no chosen option, an unknown decision and an answerer that is no id', () => {
    expect(issuesOf(AttentionResolved, { ...resolved, answer: {} })).toEqual(['answer']);
    expect(issuesOf(AttentionResolved, { ...resolved, answer: { optionIds: [] } })).toEqual([
      'answer.optionIds',
    ]);
    expect(issuesOf(AttentionResolved, { ...resolved, answer: { text: '' } })).toEqual(['answer.text']);
    expect(issuesOf(AttentionResolved, { ...resolved, answer: { decision: 'maybe' } })).toEqual([
      'answer.decision',
    ]);
    expect(issuesOf(AttentionResolved, { ...resolved, by: 'ihor' })).toEqual(['by']);
  });
});

describe('run.stop and run.ack', () => {
  it('take both stop modes and an ack from 0', () => {
    expect(issuesOf(RunStop, { ...SERVER_EXAMPLES['run.stop'], mode: 'kill' })).toEqual([]);
    expect(issuesOf(RunStop, { ...SERVER_EXAMPLES['run.stop'], mode: 'soft' })).toEqual(['mode']);
    expect(issuesOf(RunAck, { ...SERVER_EXAMPLES['run.ack'], ackedSeq: 0 })).toEqual([]);
    expect(issuesOf(RunAck, { ...SERVER_EXAMPLES['run.ack'], ackedSeq: -1 })).toEqual(['ackedSeq']);
  });
});

describe('key.rotate and runner.drain', () => {
  it('take only a runner key, and a drain with its command id', () => {
    const rotate = SERVER_EXAMPLES['key.rotate'];
    expect(issuesOf(KeyRotate, { ...rotate, runnerKey: `mwc_pk_${'A1b2'.repeat(8)}` })).toEqual([
      'runnerKey',
    ]);
    expect(issuesOf(KeyRotate, { ...rotate, runnerKey: 'mwc_rk_short' })).toEqual(['runnerKey']);
    expect(issuesOf(RunnerDrain, { type: 'runner.drain' })).toEqual(['cmdId']);
  });
});

describe('machine.hold', () => {
  it('takes a release (null) and refuses a time that is not whole milliseconds', () => {
    const hold = SERVER_EXAMPLES['machine.hold'];
    expect(issuesOf(MachineHold, { ...hold, until: null })).toEqual([]);
    expect(issuesOf(MachineHold, { ...hold, until: 1.5 })).toEqual(['until']);
    expect(issuesOf(MachineHold, without(hold, 'until'))).toEqual(['until']);
  });
});

describe('power.command', () => {
  const command = SERVER_EXAMPLES['power.command'];
  const target = command.target;

  it('takes every action, and set_timezone with its zone', () => {
    for (const action of ['start', 'stop', 'status']) {
      expect(issuesOf(PowerCommand, { ...command, action })).toEqual([]);
    }
    const setZone = { ...command, action: 'set_timezone', args: { timezone: 'Europe/Kyiv' } };
    expect(issuesOf(PowerCommand, setZone)).toEqual([]);
    expect(
      issuesOf(PowerCommand, { ...command, target: { ...target, ref: { ...target.ref, size: undefined } } }),
    ).toEqual([]);
  });

  it('refuses a provider nothing powers, a bad ref, an unknown action and a zone that is not one', () => {
    expect(issuesOf(PowerCommand, { ...command, target: { ...target, provider: 'none' } })).toEqual([
      'target.provider',
    ]);
    expect(
      issuesOf(PowerCommand, {
        ...command,
        target: { ...target, ref: { ...target.ref, instance: 'Dev_Box' } },
      }),
    ).toEqual(['target.ref.instance']);
    expect(
      issuesOf(PowerCommand, { ...command, target: { ...target, ref: { ...target.ref, zone: 'eu' } } }),
    ).toEqual(['target.ref.zone']);
    expect(
      issuesOf(PowerCommand, { ...command, target: { ...target, ref: { ...target.ref, size: 'xxl' } } }),
    ).toEqual(['target.ref.size']);
    expect(issuesOf(PowerCommand, { ...command, action: 'reboot' })).toEqual(['action']);
    const marsZone = { ...command, action: 'set_timezone', args: { timezone: 'Mars/Base' } };
    expect(issuesOf(PowerCommand, marsZone)).toEqual(['args.timezone']);
    expect(issuesOf(PowerCommand, { ...command, action: 'set_timezone' })).toEqual(['args.timezone']);
    expect(issuesOf(PowerCommand, { ...command, action: 'set_timezone', args: {} })).toEqual([
      'args.timezone',
    ]);
    expect(issuesOf(PowerCommand, { ...command, cmdId: IDS.cmd.toUpperCase().slice(1) })).toEqual(['cmdId']);
  });
});

describe('tunnel.set', () => {
  const set = SERVER_EXAMPLES['tunnel.set'];
  const tunnel = set.tunnels[0] as (typeof set.tunnels)[number];
  const other = { ...tunnel, machineId: IDS.agent, remotePort: 9960, localPort: 9960 };

  it('takes the full set, an empty one included, up to its limit', () => {
    expect(issuesOf(TunnelSet, { ...set, tunnels: [] })).toEqual([]);
    expect(issuesOf(TunnelSet, { ...set, tunnels: [tunnel, other] })).toEqual([]);
    const many = Array.from({ length: TUNNELS_MAX + 1 }, () => tunnel);
    expect(issuesOf(TunnelSet, { ...set, tunnels: many })).toEqual(['tunnels']);
  });

  it('refuses two tunnels for one machine, a port out of range, a bad target and a missing machine', () => {
    expect(issuesOf(TunnelSet, { ...set, tunnels: [tunnel, { ...tunnel, remotePort: 9960 }] })).toEqual([
      'tunnels',
    ]);
    for (const port of [0, 65536, 99.5]) {
      expect(issuesOf(TunnelSet, { ...set, tunnels: [{ ...tunnel, remotePort: port }] })).toEqual([
        'tunnels.0.remotePort',
      ]);
      expect(issuesOf(TunnelSet, { ...set, tunnels: [{ ...tunnel, localPort: port }] })).toEqual([
        'tunnels.0.localPort',
      ]);
    }
    const target = { ...tunnel.target, provider: 'none' };
    expect(issuesOf(TunnelSet, { ...set, tunnels: [{ ...tunnel, target }] })).toEqual([
      'tunnels.0.target.provider',
    ]);
    expect(issuesOf(TunnelSet, { ...set, tunnels: [without(tunnel, 'machineId')] })).toEqual([
      'tunnels.0.machineId',
    ]);
  });
});

describe('ServerFrame', () => {
  it('tells the frames apart by type and refuses an unknown one', () => {
    expect(ServerFrame.parse(SERVER_EXAMPLES['runner.drain']).type).toBe('runner.drain');
    expect(issuesOf(ServerFrame, { type: 'server.hello.update' })).toEqual(['type']);
  });
});
