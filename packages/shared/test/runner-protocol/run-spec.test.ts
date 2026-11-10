import { describe, expect, it } from 'vitest';
import {
  EnvName,
  MachinePath,
  PermissionPolicy,
  RUN_SECRETS_MAX,
  RunLimits,
  RunPlacement,
  RunSecrets,
  RunSession,
  RunSpec,
} from '../../src/runner-protocol/run-spec.ts';
import { RUN_SPEC } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf } from '../fixtures/runner-protocol/issues.ts';

describe('MachinePath and RunPlacement', () => {
  it('take an absolute path or one under ~', () => {
    for (const path of ['/Users/abibas/LAST_DANCE/airia-dev-clean-2', '~', '~/airia-dev']) {
      expect(issuesOf(MachinePath, path)).toEqual([]);
    }
    for (const path of ['', 'airia-dev', '~ihor/airia-dev', `/${'x'.repeat(1024)}`]) {
      expect(MachinePath.safeParse(path).success).toBe(false);
    }
  });

  it('take no config folder and no worktree', () => {
    expect(issuesOf(RunPlacement, { home: '~', configDir: null, worktree: null })).toEqual([]);
    expect(issuesOf(RunPlacement, { home: '~', configDir: 'claude', worktree: null })).toEqual(['configDir']);
  });
});

describe('RunSession', () => {
  it('starts new with or without an id, and resumes only with one', () => {
    expect(issuesOf(RunSession, { mode: 'new', sessionId: null })).toEqual([]);
    expect(issuesOf(RunSession, { mode: 'new', sessionId: 'b4f1' })).toEqual([]);
    expect(issuesOf(RunSession, { mode: 'resume', sessionId: 'b4f1' })).toEqual([]);
    expect(issuesOf(RunSession, { mode: 'resume', sessionId: null })).toEqual(['sessionId']);
    expect(issuesOf(RunSession, { mode: 'resume', sessionId: '' })).toEqual(['sessionId']);
    expect(issuesOf(RunSession, { mode: 'fork', sessionId: 'b4f1' })).toEqual(['mode']);
  });
});

describe('secrets and limits', () => {
  it('names secrets as environment variables, at most 64', () => {
    expect(PermissionPolicy.options).toEqual(['ask', 'bypass']);
    expect(issuesOf(EnvName, 'ANTHROPIC_BASE_URL')).toEqual([]);
    expect(issuesOf(EnvName, '_private')).toEqual([]);
    for (const name of ['1TOKEN', 'MY-TOKEN', '', `A${'B'.repeat(128)}`]) {
      expect(issuesOf(EnvName, name)).toEqual(['']);
    }
    const many = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`S${i}`, 'v']));
    expect(issuesOf(RunSecrets, many(RUN_SECRETS_MAX))).toEqual([]);
    expect(issuesOf(RunSecrets, many(RUN_SECRETS_MAX + 1))).toEqual(['']);
    expect(issuesOf(RunSecrets, { 'BAD-NAME': 'v' })).toEqual(['BAD-NAME']);
    expect(issuesOf(RunSecrets, { TOKEN: 42 })).toEqual(['TOKEN']);
  });

  it('caps nothing by default, and only with whole positive numbers', () => {
    expect(issuesOf(RunLimits, {})).toEqual([]);
    expect(issuesOf(RunLimits, { maxTurns: 1, maxDurationMs: 3_600_000 })).toEqual([]);
    expect(issuesOf(RunLimits, { maxTurns: 0 })).toEqual(['maxTurns']);
    expect(issuesOf(RunLimits, { maxDurationMs: 1.5 })).toEqual(['maxDurationMs']);
  });
});

describe('RunSpec', () => {
  it('takes a run outside a task, an empty system prompt, no inputs and no secrets', () => {
    const bare = { ...RUN_SPEC, taskId: null, systemPrompt: '', inputs: [], secrets: {}, limits: {} };
    expect(issuesOf(RunSpec, bare)).toEqual([]);
  });

  it('refuses a bad harness, model, effort, policy, input or run token', () => {
    expect(issuesOf(RunSpec, { ...RUN_SPEC, harness: 'cursor' })).toEqual(['harness']);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, model: '' })).toEqual(['model']);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, model: 'm'.repeat(101) })).toEqual(['model']);
    // Every provider's levels are a run's (Codex's ultra too); a word that is none of them is not.
    expect(issuesOf(RunSpec, { ...RUN_SPEC, effort: 'ultra' })).toEqual([]);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, effort: 'extreme' })).toEqual(['effort']);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, permissionPolicy: 'yolo' })).toEqual(['permissionPolicy']);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, inputs: [{ inputId: RUN_SPEC.runId, text: '' }] })).toEqual([
      'inputs.0.text',
    ]);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, runToken: 'x'.repeat(15) })).toEqual(['runToken']);
    expect(issuesOf(RunSpec, { ...RUN_SPEC, companyId: null })).toEqual(['companyId']);
  });
});
