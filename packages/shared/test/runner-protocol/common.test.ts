import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newId } from '../../src/ids.ts';
import {
  compareRunnerVersions,
  ErrorText,
  frame,
  JsonObject,
  protocolObject,
  RunnerVersion,
  Uuid,
} from '../../src/runner-protocol/common.ts';
import { issuesOf } from '../fixtures/runner-protocol/issues.ts';

describe('protocol objects and frames', () => {
  it('let unknown fields through and still check the known ones', () => {
    const Point = protocolObject({ x: z.number() });
    expect(Point.parse({ x: 1, z: 'kept' })).toEqual({ x: 1, z: 'kept' });
    expect(issuesOf(Point, { x: '1' })).toEqual(['x']);
  });

  it('give a frame its type literal', () => {
    const Ping = frame('test.ping', { n: z.int() });
    expect(Ping.shape.type.value).toBe('test.ping');
    expect(Ping.parse({ type: 'test.ping', n: 1 })).toEqual({ type: 'test.ping', n: 1 });
    expect(issuesOf(Ping, { type: 'test.pong', n: 1 })).toEqual(['type']);
  });
});

describe('ids, error texts and JSON objects', () => {
  it('take UUIDs only', () => {
    expect(issuesOf(Uuid, newId())).toEqual([]);
    expect(issuesOf(Uuid, '7c9e6679-7425-40de-944b-e07fc1f90ae7')).toEqual([]);
    expect(issuesOf(Uuid, 'run-1')).toEqual(['']);
  });

  it('take error texts of 1 to 2000 characters and objects of any values', () => {
    expect(issuesOf(ErrorText, '')).toEqual(['']);
    expect(issuesOf(ErrorText, 'x'.repeat(2000))).toEqual([]);
    expect(issuesOf(JsonObject, { a: [1, { b: null }] })).toEqual([]);
    expect(issuesOf(JsonObject, [1])).toEqual(['']);
  });
});

describe('RunnerVersion', () => {
  it('takes semantic versions', () => {
    for (const version of ['0.0.0', '1.2.3', '1.2.3-rc.1', '1.2.3+build.5', '10.20.30-alpha-1.b+sha.7f3']) {
      expect(issuesOf(RunnerVersion, version)).toEqual([]);
    }
  });

  it('refuses anything else', () => {
    for (const version of [
      '1.2',
      'v1.2.3',
      '01.2.3',
      '1.2.3-',
      '1.2.3-a..b',
      '1.2.3 ',
      `1.2.3-${'a'.repeat(60)}`,
    ]) {
      expect(issuesOf(RunnerVersion, version)).toEqual(['']);
    }
  });
});

describe('compareRunnerVersions', () => {
  it('orders by major, minor and patch, as numbers', () => {
    expect(compareRunnerVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareRunnerVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareRunnerVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareRunnerVersions('1.2.10', '1.2.9')).toBe(1);
  });

  it('puts a prerelease below its release and ignores the build', () => {
    expect(compareRunnerVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareRunnerVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareRunnerVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('orders prereleases as semver does', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareRunnerVersions(ordered[i - 1] as string, ordered[i] as string)).toBe(-1);
      expect(compareRunnerVersions(ordered[i] as string, ordered[i - 1] as string)).toBe(1);
    }
    expect(compareRunnerVersions('1.0.0-rc.01', '1.0.0-rc.1')).toBe(0);
  });

  it('throws on a string that is not a version', () => {
    expect(() => compareRunnerVersions('1.0', '1.0.0')).toThrow(TypeError);
    expect(() => compareRunnerVersions('1.0.0', 'latest')).toThrow('Not a version: "latest"');
  });
});
