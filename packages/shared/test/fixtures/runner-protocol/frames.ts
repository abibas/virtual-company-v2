import type { AskQuestion, TurnSpec } from '../../../src/harness.ts';
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
  session: newId(),
  turn: newId(),
  question: newId(),
} as const;

/** A question an agent asks: one pick of two options. */
export const QUESTION: AskQuestion = {
  question: 'Which database should the service use?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'The one the other services use' },
    { label: 'SQLite', description: 'A file beside the service, nothing to run' },
  ],
  multiSelect: false,
};

export const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

/** The CLIs a Mac's runner found: Claude Code, Codex and git; no gh, no Docker. */
export const TOOLS = {
  claude: '2.1.319 (Claude Code)',
  codex: 'codex-cli 0.163.0',
  git: 'git version 2.39.5 (Apple Git-154)',
  gh: null,
  docker: null,
} as const;

/** A runner build: the SHA-256 of a bundle. */
export const BUILD = 'ab'.repeat(32);

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

/** A turn of Claude Code on a setup-token, resuming a session. */
export const TURN_SPEC: TurnSpec = {
  harness: 'claude_code',
  cwd: '/Users/ihor/agents/slop-box',
  prompt: 'What is 2 + 2?',
  sessionId: 'b4c1f0e2-session',
  model: 'claude-opus-5-5',
  effort: 'high',
  permissionPolicy: 'ask',
  configDir: null,
  credential: { kind: 'claude_setup_token', token: 'sk-ant-oat01-test' },
  gateway: null,
};

export const RUNNER_EXAMPLES: { readonly [T in RunnerFrameType]: Extract<RunnerFrame, { type: T }> } = {
  'runner.hello': {
    type: 'runner.hello',
    protocol: 1,
    version: '0.5.0',
    caps: {
      harnesses: { claude_code: '2.1.319 (Claude Code)', codex: 'codex-cli 0.163.0' },
      slots: 2,
      hold: 'caffeinate',
      power: ['airia_devbox'],
      terminal: true,
      selfUpdate: true,
      folders: true,
      mkdirp: true,
      forks: true,
      reattach: true,
      agentTools: true,
      decisions: true,
      serverTools: true,
      github: true,
      tools: TOOLS,
    },
    build: BUILD,
    builtAt: '2026-11-09T16:40:00.000Z',
    turns: [{ turnId: IDS.turn, lastSeq: 12, ended: false }],
  },
  'runner.caps': {
    type: 'runner.caps',
    caps: {
      harnesses: { claude_code: '2.1.319 (Claude Code)', codex: 'codex-cli 0.163.0' },
      slots: 2,
      hold: 'caffeinate',
      power: [],
      terminal: true,
      selfUpdate: true,
      folders: true,
      mkdirp: true,
      forks: true,
      reattach: true,
      agentTools: true,
      decisions: true,
      serverTools: true,
      github: true,
      tools: TOOLS,
    },
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
  'tunnel.state': { type: 'tunnel.state', machineId: IDS.machine, state: 'up' },
  'terminal.opened': { type: 'terminal.opened', sessionId: IDS.session, shell: '/bin/zsh' },
  'terminal.output': { type: 'terminal.output', sessionId: IDS.session, data: 'aGVsbG8NCg==' },
  'terminal.exit': { type: 'terminal.exit', sessionId: IDS.session, code: null, signal: 'SIGHUP' },
  'runner.update.result': { type: 'runner.update.result', cmdId: IDS.cmd, ok: true, build: BUILD },
  'turn.events': {
    type: 'turn.events',
    turnId: IDS.turn,
    events: [
      { seq: 1, event: { type: 'session', sessionId: 'b4c1f0e2-session' } },
      { seq: 2, event: { type: 'text', text: '4' } },
    ],
  },
  'turn.question': {
    type: 'turn.question',
    turnId: IDS.turn,
    seq: 3,
    questionId: IDS.question,
    questions: [QUESTION],
  },
  'turn.tool': {
    type: 'turn.tool',
    turnId: IDS.turn,
    callId: IDS.question,
    tool: 'task_hand_on',
    input: { summary: 'Fixed the empty password check; branch fix/login.' },
  },
  'turn.artifact': {
    type: 'turn.artifact',
    turnId: IDS.turn,
    index: 0,
    path: 'notes.md',
    contentType: 'text/markdown; charset=utf-8',
    size: 5,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    part: 0,
    parts: 1,
    data: 'aGVsbG8=',
  },
  'turn.artifacts': {
    type: 'turn.artifacts',
    turnId: IDS.turn,
    files: 1,
    skipped: [{ path: 'build.zip', size: 4096, reason: 'binary' }],
  },
  'turn.end': { type: 'turn.end', turnId: IDS.turn, ok: true, exitCode: 0 },
  'fs.result': {
    type: 'fs.result',
    cmdId: IDS.cmd,
    ok: true,
    path: '/Users/ihor/agents',
    parent: '/Users/ihor',
    entries: [
      { name: 'scout', git: false, claudeMd: true },
      { name: 'slop-box', git: true, claudeMd: true },
    ],
    truncated: false,
    home: '/Users/ihor',
    root: null,
  },
  'tools.output': { type: 'tools.output', cmdId: IDS.cmd, line: 'added 2 packages in 4s' },
  'tools.result': { type: 'tools.result', cmdId: IDS.cmd, ok: true, tools: TOOLS },
};

export const SERVER_EXAMPLES: { readonly [T in ServerFrameType]: Extract<ServerFrame, { type: T }> } = {
  'server.hello': {
    type: 'server.hello',
    protocol: 1,
    minRunnerVersion: '0.5.0',
    machineId: IDS.machine,
    resume: true,
  },
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
  'tunnel.set': {
    type: 'tunnel.set',
    tunnels: [
      {
        machineId: IDS.machine,
        target: { provider: 'airia_devbox', ref: { instance: 'dev-ihorherasko', zone: 'europe-west1-b' } },
        remotePort: 9950,
        localPort: 9950,
      },
    ],
  },
  'terminal.open': { type: 'terminal.open', sessionId: IDS.session, cols: 120, rows: 40 },
  'terminal.input': { type: 'terminal.input', sessionId: IDS.session, data: 'bHMgLWxhDQ==' },
  'terminal.resize': { type: 'terminal.resize', sessionId: IDS.session, cols: 80, rows: 24 },
  'terminal.close': { type: 'terminal.close', sessionId: IDS.session },
  'runner.update': { type: 'runner.update', cmdId: IDS.cmd },
  'turn.start': { type: 'turn.start', turnId: IDS.turn, spec: TURN_SPEC },
  'turn.input': {
    type: 'turn.input',
    turnId: IDS.turn,
    inputId: IDS.input,
    text: 'Use the staging database',
  },
  'turn.stop': { type: 'turn.stop', turnId: IDS.turn },
  'turn.resume': {
    type: 'turn.resume',
    turns: [
      { turnId: IDS.turn, lastSeq: 12 },
      { turnId: IDS.run, lastSeq: null },
    ],
  },
  'turn.ack': { type: 'turn.ack', turnId: IDS.turn },
  'turn.tool.result': {
    type: 'turn.tool.result',
    turnId: IDS.turn,
    callId: IDS.question,
    ok: true,
    text: 'Recorded: when your turn ends the task goes to "Code review". End your turn now.',
  },
  'fs.list': { type: 'fs.list', cmdId: IDS.cmd, path: '~/agents' },
  'fs.mkdir': { type: 'fs.mkdir', cmdId: IDS.cmd, path: '/Users/ihor/agents/scout' },
  'fs.mkdirp': { type: 'fs.mkdirp', cmdId: IDS.cmd, path: '/work/test-dev' },
  'tools.check': { type: 'tools.check', cmdId: IDS.cmd },
  'tools.install': { type: 'tools.install', cmdId: IDS.cmd, tool: 'codex', version: '0.163.0' },
};
