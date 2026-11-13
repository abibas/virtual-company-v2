import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as enums from '../src/enums.ts';
import {
  AiriaDevboxRef,
  DEFAULT_MACHINE_POWER_POLICY,
  DevboxSize,
  HoldDriver,
  InstallableTool,
  isTimeZone,
  KeepOnWindow,
  MachineKind,
  MachinePowerPolicy,
  MachineProvider,
  MachineSample,
  MachineStatus,
  MachineTool,
  PlacementMode,
  PlacementPath,
  PowerAction,
  PowerEventAction,
  PowerProvider,
  PowerStatus,
  TimeOfDay,
  TimeZone,
  TOOL_PACKAGES,
  toolNeedsUpdate,
  toolVersionNumber,
  Weekday,
} from '../src/machines.ts';
import { SAMPLE } from './fixtures/runner-protocol/frames.ts';
import { issuesOf } from './fixtures/runner-protocol/issues.ts';

describe('the machines enums', () => {
  it('are the database enums of ./enums.ts', () => {
    expect(MachineKind).toBe(enums.MachineKind);
    expect(MachineProvider).toBe(enums.MachineProvider);
    expect(MachineStatus).toBe(enums.MachineStatus);
    expect(PowerEventAction).toBe(enums.PowerEventAction);
    expect(PlacementMode).toBe(enums.PlacementMode);
  });

  it('list the protocol values', () => {
    expect(PowerProvider.options).toEqual(['airia_devbox']);
    expect(PowerAction.options).toEqual(['start', 'stop', 'status', 'set_timezone']);
    expect(PowerStatus.options).toEqual(['running', 'stopped', 'starting', 'stopping', 'missing', 'unknown']);
    expect(HoldDriver.options).toEqual(['devbox_keepalive', 'caffeinate', 'none']);
    expect(DevboxSize.options).toEqual(['s', 'm', 'l', 'xl']);
  });
});

describe('PlacementPath', () => {
  it('takes an absolute path on one line, trimmed, up to 500 characters', () => {
    expect(PlacementPath.parse('  /Users/ihor/agents/slop-box ')).toBe('/Users/ihor/agents/slop-box');
    expect(PlacementPath.parse(`/${'a'.repeat(499)}`)).toHaveLength(500);
    for (const bad of ['', '   ', 'agents/slop-box', '~/airia-dev', '/a\nb', `/${'a'.repeat(500)}`]) {
      expect(PlacementPath.safeParse(bad).success).toBe(false);
    }
  });
});

describe('MachineSample', () => {
  it('takes a sample, with fractional loads and percentages', () => {
    expect(MachineSample.parse(SAMPLE)).toEqual(SAMPLE);
    expect(issuesOf(MachineSample, { ...SAMPLE, cpuPct: 0, memPct: 100, liveRuns: 0, uptimeS: 0 })).toEqual(
      [],
    );
  });

  it('refuses negative loads, percentages over 100, no CPU and fractional bytes or seconds', () => {
    expect(issuesOf(MachineSample, { ...SAMPLE, load5: -1 })).toEqual(['load5']);
    expect(issuesOf(MachineSample, { ...SAMPLE, memPct: 100.1 })).toEqual(['memPct']);
    expect(issuesOf(MachineSample, { ...SAMPLE, cpus: 0 })).toEqual(['cpus']);
    expect(issuesOf(MachineSample, { ...SAMPLE, diskUsed: 1.5 })).toEqual(['diskUsed']);
    expect(issuesOf(MachineSample, { ...SAMPLE, uptimeS: 12.3 })).toEqual(['uptimeS']);
    expect(issuesOf(MachineSample, { ...SAMPLE, at: '2026-11-06' })).toEqual(['at']);
  });
});

describe('AiriaDevboxRef', () => {
  it('takes a gcloud instance and zone, the size optional', () => {
    expect(issuesOf(AiriaDevboxRef, { instance: 'dev-ihorherasko', zone: 'us-central1-a' })).toEqual([]);
    expect(issuesOf(AiriaDevboxRef, { instance: 'dev-x', zone: 'europe-west1-b', size: 'xl' })).toEqual([]);
    expect(issuesOf(AiriaDevboxRef, { instance: '-dev', zone: 'us-central1-a' })).toEqual(['instance']);
    expect(issuesOf(AiriaDevboxRef, { instance: 'dev', zone: 'us-central1' })).toEqual(['zone']);
  });
});

describe('times, days and zones', () => {
  it('take HH:MM on a 24-hour clock', () => {
    for (const time of ['00:00', '09:00', '19:30', '23:59']) expect(issuesOf(TimeOfDay, time)).toEqual([]);
    for (const time of ['24:00', '9:00', '09:60', '0900']) expect(issuesOf(TimeOfDay, time)).toEqual(['']);
  });

  it('take ISO weekdays 1 to 7', () => {
    expect(issuesOf(Weekday, 1)).toEqual([]);
    expect(issuesOf(Weekday, 7)).toEqual([]);
    expect(issuesOf(Weekday, 0)).toEqual(['']);
    expect(issuesOf(Weekday, 8)).toEqual(['']);
  });

  it('take IANA zone names the runtime knows, never offsets', () => {
    for (const zone of ['Europe/Kyiv', 'UTC', 'America/New_York', 'Etc/GMT+3'])
      expect(isTimeZone(zone)).toBe(true);
    for (const zone of ['Mars/Base', '+02:00', '', 'GMT +3']) expect(isTimeZone(zone)).toBe(false);
    expect(issuesOf(TimeZone, 'Europe/Kyiv')).toEqual([]);
    expect(issuesOf(TimeZone, 'Mars/Base')).toEqual(['']);
  });
});

describe('KeepOnWindow', () => {
  const window = KeepOnWindow.parse({});

  it('takes an overnight window and any order of distinct days', () => {
    expect(issuesOf(KeepOnWindow, { ...window, from: '22:00', to: '06:00' })).toEqual([]);
    expect(issuesOf(KeepOnWindow, { ...window, days: [7, 1, 3] })).toEqual([]);
  });

  it('refuses no day, a repeated or unknown day, the same from and to, and an unknown zone', () => {
    expect(issuesOf(KeepOnWindow, { ...window, days: [] })).toEqual(['days']);
    expect(issuesOf(KeepOnWindow, { ...window, days: [1, 1] })).toEqual(['days']);
    expect(issuesOf(KeepOnWindow, { ...window, days: [1, 2, 3, 4, 5, 6, 7, 1] })).toEqual(['days']);
    expect(issuesOf(KeepOnWindow, { ...window, days: [0] })).toEqual(['days.0']);
    expect(issuesOf(KeepOnWindow, { ...window, from: '09:00', to: '09:00' })).toEqual(['to']);
    expect(issuesOf(KeepOnWindow, { ...window, timezone: 'Kyiv' })).toEqual(['timezone']);
  });
});

describe('MachinePowerPolicy', () => {
  it('defaults to the policy of docs/machines.md: hours off, nothing starts by itself', () => {
    expect(DEFAULT_MACHINE_POWER_POLICY).toEqual({
      keepOn: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00', timezone: 'Europe/Kyiv' },
      holdAfterTurnMin: 45,
      keepMacAwake: true,
      autoStartAtKeepOn: false,
      autoStartOnWork: false,
      autoStartOnMessage: false,
      stopAtKeepOnEnd: true,
    });
    expect(MachinePowerPolicy.parse({})).toEqual(DEFAULT_MACHINE_POWER_POLICY);
  });

  it('fills what a stored policy lacks, inside the hours too', () => {
    const policy = MachinePowerPolicy.parse({ keepOn: { enabled: true, to: '18:00' }, holdAfterTurnMin: 0 });
    expect(policy.keepOn).toEqual({ ...DEFAULT_MACHINE_POWER_POLICY.keepOn, enabled: true, to: '18:00' });
    expect(policy.holdAfterTurnMin).toBe(0);
    expect(policy.stopAtKeepOnEnd).toBe(true);
  });

  it('holds a turn 0 to 720 minutes, in whole minutes', () => {
    expect(issuesOf(MachinePowerPolicy, { holdAfterTurnMin: 720 })).toEqual([]);
    expect(issuesOf(MachinePowerPolicy, { holdAfterTurnMin: 721 })).toEqual(['holdAfterTurnMin']);
    expect(issuesOf(MachinePowerPolicy, { holdAfterTurnMin: -1 })).toEqual(['holdAfterTurnMin']);
    expect(issuesOf(MachinePowerPolicy, { holdAfterTurnMin: 7.5 })).toEqual(['holdAfterTurnMin']);
    expect(issuesOf(MachinePowerPolicy, { keepMacAwake: 'yes' })).toEqual(['keepMacAwake']);
    expect(issuesOf(MachinePowerPolicy, { keepOn: { days: [8] } })).toEqual(['keepOn.days.0']);
  });
});

describe('the machine tools', () => {
  it('are five CLIs, of which the page installs Claude Code and Codex', () => {
    expect(MachineTool.options).toEqual(['claude', 'codex', 'git', 'gh', 'docker']);
    expect(InstallableTool.options).toEqual(['claude', 'codex']);
  });

  it('install the versions the Dockerfiles pin', () => {
    for (const file of ['Dockerfile.login', 'Dockerfile.runner']) {
      const text = readFileSync(new URL(`../../../deploy/${file}`, import.meta.url), 'utf8');
      for (const { name, version } of Object.values(TOOL_PACKAGES))
        expect(text).toContain(`${name}@${version}`);
    }
  });

  it('read the version a CLI printed and say when it is older than the pinned one', () => {
    expect(toolVersionNumber('2.1.319 (Claude Code)')).toBe('2.1.319');
    expect(toolVersionNumber('codex-cli 0.163.0')).toBe('0.163.0');
    expect(toolVersionNumber('Docker version 27.3.1, build ce12230')).toBe('27.3.1');
    expect(toolVersionNumber('gh version 2.40')).toBe('2.40');
    expect(toolVersionNumber('no number')).toBeUndefined();
    expect(toolNeedsUpdate('codex-cli 0.162.1', '0.163.0')).toBe(true);
    expect(toolNeedsUpdate('2.1.99 (Claude Code)', '2.1.308')).toBe(true);
    expect(toolNeedsUpdate('codex-cli 0.163.0', '0.163.0')).toBe(false);
    expect(toolNeedsUpdate('2.1.319 (Claude Code)', '2.1.308')).toBe(false);
    expect(toolNeedsUpdate('codex-cli 1.0', '0.163.0')).toBe(false);
    expect(toolNeedsUpdate('2.1 (Claude Code)', '2.1.308')).toBe(true);
    expect(toolNeedsUpdate('a version we cannot read', '0.163.0')).toBe(false);
  });
});
