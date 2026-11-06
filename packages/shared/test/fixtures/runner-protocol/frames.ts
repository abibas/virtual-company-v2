import { newId } from '../../../src/ids.ts';
import type { MachineSample } from '../../../src/machines.ts';
import type {
  RunnerFrame,
  RunnerFrameType,
  RunSpec,
  ServerFrame,
  ServerFrameType,
} from '../../../src/runner-protocol.ts';

/** One valid example of every frame, typed so that a frame type without one fails the typecheck. */

export const IDS = {
  run: newId(),
  company: newId(),
  agent: newId(),
  task: newId(),
  offer: newId(),
  cmd: newId(),
  machine: newId(),
  attention: newId(),
  input: newId(),
  principal: newId(),
} as const;

export const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

export const SAMPLE: MachineSample = {
  load1: 0.42,
  load5: 0.3,
  load15: 0.25,
  cpus: 8,
  cpuPct: 12.5,
  memPct: 61,
  diskUsed: 120_000_000_000,
  diskTotal: 500_000_000_000,
  uptimeS: 86_400,
  liveRuns: 1,
  at: NOW,
};

export const RUN_SPEC: RunSpec = {
  runId: IDS.run,
  companyId: IDS.company,
  agentId: IDS.agent,
  taskId: IDS.task,
  harness: 'claude_code',
  placement: { home: '~/airia-dev', configDir: null, worktree: '~/airia-dev/worktrees/SS-2887' },
  session: { mode: 'resume', sessionId: newId() },
  model: 'claude-opus-5-5',
  effort: 'high',
  permissionPolicy: 'ask',
  systemPrompt: 'You are the coder of the Airia Platform team.',
  inputs: [{ inputId: IDS.input, text: 'Solve this' }],
  secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' },
  runToken: 'run-token-0123456789abcdef',
  limits: { maxTurns: 200 },
};

export const RUNNER_EXAMPLES: { readonly [T in RunnerFrameType]: Extract<RunnerFrame, { type: T }> } = {
  'runner.hello': {
    type: 'runner.hello',
    protocol: 1,
    version: '0.5.0',
    caps: { harnesses: ['claude_code'], slots: 2, hold: 'caffeinate', power: ['airia_devbox'] },
  },
  'runner.heartbeat': {
    type: 'runner.heartbeat',
    awakeMs: 120_000,
    load1: 0.42,
    liveRuns: [IDS.run],
    backlog: 3,
    now: NOW,
    sample: SAMPLE,
  },
  'runner.resync': {
    type: 'runner.resync',
    runs: [
      { runId: IDS.run, state: 'running', exitCode: null, lastSeq: 17 },
      { runId: newId(), state: 'exited', exitCode: 0, lastSeq: 40 },
    ],
  },
  'job.accept': { type: 'job.accept', id: IDS.offer, runId: IDS.run },
  'job.decline': { type: 'job.decline', id: IDS.offer, runId: IDS.run, reason: 'no free slot' },
  'run.events': {
    type: 'run.events',
    events: [{ runId: IDS.run, seq: 18, at: NOW, kind: 'text', data: { text: 'Done.' } }],
  },
  'attention.create': {
    type: 'attention.create',
    id: IDS.attention,
    runId: IDS.run,
    kind: 'question',
    wait: 'live',
    prompt: 'Which branch?',
    options: [
      { id: 'main', label: 'main' },
      { id: 'new', label: 'A new branch', description: 'from origin/main' },
    ],
  },
  'cmd.ack': { type: 'cmd.ack', cmdId: IDS.cmd, ok: true },
  'hold.state': { type: 'hold.state', until: NOW + 45 * 60_000, source: 'server' },
  'power.result': {
    type: 'power.result',
    cmdId: IDS.cmd,
    ok: true,
    status: 'running',
    metadata: { zone: 'europe-west1-b', 'devbox-tz': 'Europe/Kyiv' },
  },
};

export const SERVER_EXAMPLES: { readonly [T in ServerFrameType]: Extract<ServerFrame, { type: T }> } = {
  'server.hello': { type: 'server.hello', protocol: 1, minRunnerVersion: '0.5.0', machineId: IDS.machine },
  'job.offer': {
    type: 'job.offer',
    id: IDS.offer,
    runId: IDS.run,
    agentId: IDS.agent,
    expiresAt: NOW + 30_000,
  },
  'run.start': { type: 'run.start', cmdId: IDS.cmd, spec: RUN_SPEC },
  'run.input': {
    type: 'run.input',
    cmdId: IDS.cmd,
    runId: IDS.run,
    inputId: IDS.input,
    text: 'Also add a test.',
  },
  'attention.resolved': {
    type: 'attention.resolved',
    cmdId: IDS.cmd,
    runId: IDS.run,
    attentionId: IDS.attention,
    answer: { optionIds: ['main'] },
    by: IDS.principal,
  },
  'run.stop': { type: 'run.stop', cmdId: IDS.cmd, runId: IDS.run, mode: 'graceful' },
  'run.ack': { type: 'run.ack', runId: IDS.run, ackedSeq: 18 },
  'key.rotate': { type: 'key.rotate', cmdId: IDS.cmd, runnerKey: `mwc_rk_${'A1b2'.repeat(8)}` },
  'runner.drain': { type: 'runner.drain', cmdId: IDS.cmd },
  'machine.hold': { type: 'machine.hold', cmdId: IDS.cmd, until: NOW + 45 * 60_000 },
  'power.command': {
    type: 'power.command',
    cmdId: IDS.cmd,
    target: {
      provider: 'airia_devbox',
      ref: { instance: 'dev-ihorherasko', zone: 'europe-west1-b', size: 'm' },
    },
    action: 'start',
  },
};
