import { describe, expect, it } from 'vitest';
import {
  agentTypeOf,
  CHILD_SEARCHES_MAX,
  FOLLOW_READ_BYTES,
  FOLLOW_ROUND_BYTES,
  FOLLOWED_CHILDREN_MAX,
  LiveSubagents,
} from '../../src/follow/live.ts';
import { newCollabState } from '../../src/subagents.ts';
import {
  activityEvent,
  activityItem,
  commandItem,
  LUNA,
  line,
  messageItem,
  meta,
  NOW_S,
  ownTurn,
  PARENT,
  pathOf,
  SINCE,
  SOL,
  solLines,
  spawnCall,
  TERRA,
  taskComplete,
  taskStarted,
} from '../fixtures/follow.ts';
import { memoryRollouts } from '../fixtures/rollout.ts';

const HOME = '/state/codex/10b1a5d4a9d1aa79';
const OLD = '019a6f00-0000-7000-8000-000000000001';
const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;

/** A follower on files in memory, the agent's file at `parent` when given. */
function world(parent?: readonly string[], day = '2026/11/09') {
  const files: Record<string, string> = {};
  if (parent) files[pathOf(HOME, PARENT, day)] = text(parent);
  const memory = memoryRollouts(files);
  const state = newCollabState();
  const live = new LiveSubagents({ fs: memory.fs, home: HOME, since: SINCE }, state);
  const append = (path: string, lines: readonly string[]) => {
    files[path] = (files[path] ?? '') + text(lines);
  };
  return { ...memory, files, state, live, append, parentPath: pathOf(HOME, PARENT, day) };
}

const sub = (id: string, agentType: string, more: object = {}) => ({
  type: 'subagent',
  id,
  agentType,
  description: '',
  background: true,
  status: 'running',
  ...more,
});

describe('LiveSubagents: a resumed thread on multi-agent v2', () => {
  it('starts each subagent from the agent’s file, then nests its own steps and its answer under it', () => {
    const w = world([
      meta(PARENT),
      taskStarted(NOW_S - 3600),
      activityItem('old', OLD, '/root/old', 'started'),
    ]);
    expect(w.live.poll()).toEqual([]);
    w.live.thread(PARENT);
    expect(w.live.poll()).toEqual([]);
    w.append(w.parentPath, [
      taskStarted(),
      spawnCall('call_sol', {
        task_name: 'sleep_sol',
        message: 'Sleep 45 seconds.\nReport.',
        model: 'gpt-6.1-sol',
      }),
      activityItem('call_sol', SOL, '/root/sleep_sol', 'started', 'gpt-6.1-sol', 'high'),
      spawnCall('call_terra', { task_name: 'sleep_terra', message: 'Sleep 50 seconds.' }),
      activityItem('call_terra', TERRA, '/root/sleep_terra', 'started', 'gpt-6.1-terra', 'medium'),
    ]);
    const sol = sub(SOL, 'sleep_sol', {
      description: 'Sleep 45 seconds.',
      model: 'gpt-6.1-sol',
      effort: 'high',
    });
    const terra = sub(TERRA, 'sleep_terra', {
      description: 'Sleep 50 seconds.',
      model: 'gpt-6.1-terra',
      effort: 'medium',
    });
    expect(w.live.poll()).toEqual([sol, terra]);

    w.append(pathOf(HOME, SOL, '2026/11/10'), solLines());
    const id = `${SOL}:call_sol`;
    expect(w.live.poll()).toEqual([
      {
        type: 'tool',
        id,
        name: 'command',
        summary: "python3 -c 'import time; time.sleep(45)'",
        parentId: SOL,
      },
      { type: 'tool_result', id, ok: true, summary: 'exit 0', parentId: SOL },
      { type: 'text', text: 'Slept 45 seconds.', parentId: SOL },
      { ...sol, status: 'done', summary: 'Slept 45 seconds.' },
    ]);
    w.append(w.parentPath, [activityItem('subagent-completed-1', SOL, '/root/sleep_sol', 'completed')]);
    expect(w.live.poll()).toEqual([]);
    expect([...w.state.read]).toEqual([SOL, TERRA]);
    expect(w.live.finish()).toEqual([]);
    w.append(w.parentPath, [activityItem('subagent-completed-2', TERRA, '/root/sleep_terra', 'completed')]);
    expect(w.live.poll()).toEqual([]);
  });

  it('reads an activity written across two polls once whole', () => {
    const w = world([meta(PARENT)]);
    w.live.thread(PARENT);
    const started = activityItem('c', SOL, '/root/sleep_sol', 'started');
    w.files[w.parentPath] += started.slice(0, 40);
    expect(w.live.poll()).toEqual([]);
    w.files[w.parentPath] += `${started.slice(40)}\n`;
    expect(w.live.poll()).toEqual([sub(SOL, 'sleep_sol')]);
  });

  it('moves a subagent as its activities say, and ends a child turn that failed as failed', () => {
    const w = world([meta(PARENT)]);
    w.live.thread(PARENT);
    w.append(w.parentPath, [
      activityItem('c', SOL, '/root/sleep_sol', 'started'),
      activityItem('i', SOL, '/root/sleep_sol', 'interrupted'),
      activityItem('f', SOL, '/root/sleep_sol', 'interacted'),
      activityItem('x', OLD, '/root/old', 'completed'),
      activityItem('y', OLD, '/root/old', 'interrupted'),
    ]);
    expect(w.live.poll()).toEqual([
      sub(SOL, 'sleep_sol'),
      sub(SOL, 'sleep_sol', { status: 'interrupted' }),
      sub(SOL, 'sleep_sol'),
    ]);
    w.append(pathOf(HOME, SOL, '2026/11/10'), [
      meta(SOL, 'paginated', PARENT),
      ownTurn(),
      taskComplete(null, 'boom'),
    ]);
    expect(w.live.poll()).toEqual([sub(SOL, 'sleep_sol', { status: 'failed', summary: 'boom' })]);
  });
});

describe('LiveSubagents: a thread whose file appears during the turn', () => {
  it('reads it from its start, skipping the history copied into it, and fills a description its call gives later', () => {
    const w = world();
    w.live.thread(PARENT);
    expect(w.live.poll()).toEqual([]);
    w.append(pathOf(HOME, PARENT, '2026/11/10'), [
      meta(PARENT, 'legacy'),
      taskStarted(NOW_S - 600),
      activityEvent('old', OLD, '/root/old', 'started'),
      spawnCall('old', { message: 'Old.' }),
      taskStarted(),
      activityEvent('call_luna', LUNA, '/root/sleep_luna', 'started', 'gpt-6.1-luna', null),
      spawnCall('call_luna', { message: 'Sleep 30 seconds.', reasoning_effort: 'low' }),
      spawnCall('call_luna', { message: 'Again.' }),
    ]);
    const luna = sub(LUNA, 'sleep_luna', { model: 'gpt-6.1-luna' });
    expect(w.live.poll()).toEqual([luna, { ...luna, description: 'Sleep 30 seconds.', effort: 'low' }]);
  });

  it('looks for a file it found but could not read again, in the newest days only', () => {
    const w = world([meta(PARENT)], '2026/11/10');
    const blind = new LiveSubagents(
      { fs: { ...w.fs, readAt: () => undefined }, home: HOME, since: SINCE },
      newCollabState(),
    );
    blind.thread(PARENT);
    expect(blind.poll()).toEqual([]);
    const old = world([meta(PARENT)], '2026/11/01');
    old.files[`${HOME}/sessions/2026/11/10/rollout-x-other.jsonl`] = '';
    old.files[`${HOME}/sessions/2026/11/09/rollout-x-other.jsonl`] = '';
    old.live.thread('019a6f2e-0000-7000-8000-00000000dead');
    expect(old.listed).toContain(`${HOME}/sessions/2026/11/01`);
    old.listed.length = 0;
    expect(old.live.poll()).toEqual([]);
    const sessions = `${HOME}/sessions`;
    expect(old.listed).toEqual([
      sessions,
      `${sessions}/2026`,
      `${sessions}/2026/11`,
      `${sessions}/2026/11/10`,
      `${sessions}/2026/11/09`,
    ]);
  });
});

describe('LiveSubagents: bounds', () => {
  const filler = line('response_item', { type: 'reasoning', encrypted_content: 'x'.repeat(10_000) });
  const big = Array.from({ length: 110 }, () => filler);
  const child = (id: string) => ({
    id,
    agentType: 'Codex agent',
    description: '',
    background: true,
    status: 'running' as const,
  });
  const idOf = (n: number) => `019a6f30-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const said = (id: string) => [meta(id, 'paginated', PARENT), ownTurn(), messageItem(`hi ${id}`)];

  it(`follows at most ${FOLLOWED_CHILDREN_MAX} subagents' files`, () => {
    const w = world([meta(PARENT)]);
    w.live.thread(PARENT);
    for (let n = 0; n <= FOLLOWED_CHILDREN_MAX; n++) {
      w.state.subagents.set(idOf(n), child(idOf(n)));
      w.append(pathOf(HOME, idOf(n), '2026/11/09'), said(idOf(n)));
    }
    const parents = w.live.poll().flatMap((event) => ('parentId' in event ? [event.parentId] : []));
    expect(parents).toHaveLength(FOLLOWED_CHILDREN_MAX);
    expect(parents).not.toContain(idOf(FOLLOWED_CHILDREN_MAX));
  });

  it(`gives up a subagent's file after ${CHILD_SEARCHES_MAX} polls without it`, () => {
    const w = world([meta(PARENT)]);
    w.live.thread(PARENT);
    w.state.subagents.set(SOL, child(SOL));
    for (let n = 0; n < CHILD_SEARCHES_MAX; n++) w.live.poll();
    const searched = w.listed.length;
    w.live.poll();
    w.append(pathOf(HOME, SOL, '2026/11/09'), said(SOL));
    expect(w.live.poll()).toEqual([]);
    expect(w.listed).toHaveLength(searched);
  });

  it(`reads at most ${FOLLOW_READ_BYTES} bytes of a file and ${FOLLOW_ROUND_BYTES} in all per poll`, () => {
    const w = world([meta(PARENT)]);
    w.live.thread(PARENT);
    w.append(w.parentPath, big);
    const ids = [1, 2, 3, 4].map(idOf);
    for (const id of ids) w.state.subagents.set(id, child(id));
    for (const id of ids.slice(0, 3)) w.append(pathOf(HOME, id, '2026/11/09'), [...said(id), ...big]);
    const last = ids[3] as string;
    w.append(pathOf(HOME, last, '2026/11/09'), said(last));
    const texts = () => w.live.poll().filter((event) => event.type === 'text');
    expect(texts()).toHaveLength(3);
    expect(w.readsAt.map(([, , bytes]) => bytes)).toEqual([0, ...Array(4).fill(FOLLOW_READ_BYTES)]);
    expect(w.readsAt.map(([path]) => path)).not.toContain(pathOf(HOME, last, '2026/11/09'));
    expect(texts()).toEqual([{ type: 'text', text: `hi ${last}`, parentId: last }]);
  });
});

describe('LiveSubagents: v1 and v2 together', () => {
  it('keeps one subagent per thread: an activity moves the collab one, its file nests its steps', () => {
    const w = world([meta(PARENT)]);
    const v1 = {
      id: SOL,
      agentType: 'Codex agent',
      description: 'Sleep a while.',
      background: true,
      status: 'running' as const,
    };
    w.state.subagents.set(SOL, v1);
    w.live.thread(PARENT);
    w.append(w.parentPath, [activityItem('c', SOL, '/root/sleep_sol', 'started', 'gpt-6.1-sol', 'high')]);
    w.append(pathOf(HOME, SOL, '2026/11/10'), [
      meta(SOL, 'paginated', PARENT),
      ownTurn(),
      commandItem('k1', ['ls']),
      messageItem('Done.'),
      taskComplete('Done.'),
    ]);
    const merged = { type: 'subagent', ...v1, model: 'gpt-6.1-sol', effort: 'high' };
    expect(w.live.poll()).toEqual([
      merged,
      { type: 'tool', id: `${SOL}:k1`, name: 'command', summary: 'ls', parentId: SOL },
      { type: 'tool_result', id: `${SOL}:k1`, ok: true, summary: 'exit 0', parentId: SOL },
      { type: 'text', text: 'Done.', parentId: SOL },
      { ...merged, summary: 'Done.' },
    ]);
    expect([...w.state.subagents.keys()]).toEqual([SOL]);
    expect(w.state.read.has(SOL)).toBe(false);
  });
});

describe('agentTypeOf', () => {
  it('names a subagent by its path under the root', () => {
    expect(agentTypeOf('/root/sleep_sol')).toBe('sleep_sol');
    expect(agentTypeOf('/root/team/helper')).toBe('team/helper');
    expect(agentTypeOf('/morpheus')).toBe('morpheus');
    expect(agentTypeOf('/root')).toBe('Codex agent');
    expect(agentTypeOf(' ')).toBe('Codex agent');
  });
});
