import { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import type { CodexChild } from '../src/children.ts';
import {
  CODEX_AGENT_TYPE,
  collabEvents,
  endedSubagents,
  newCollabState,
  type ReadChild,
} from '../src/subagents.ts';
import { CHILD_A, CHILD_B, CHILD_C } from './fixtures/children.ts';

const PROMPT = '\n  Run python3 wait.py and say how long it slept.\nUse model gpt-5.5.';
const DESCRIPTION = 'Run python3 wait.py and say how long it slept.';

/** A `collab_tool_call` item, as `codex exec --json` writes it. */
function collab(
  tool: string,
  status: string,
  receivers: readonly unknown[] = [],
  states: Record<string, unknown> = {},
  prompt: string | null = tool === 'spawn_agent' ? PROMPT : null,
) {
  return {
    id: `item_${tool}`,
    type: 'collab_tool_call',
    tool,
    sender_thread_id: 'parent',
    receiver_thread_ids: receivers,
    prompt,
    agents_states: states,
    status,
  };
}

const state = (status: string, message: string | null = null) => ({ status, message });

const subagent = (id: string, more: object = {}) => ({
  type: 'subagent',
  id,
  agentType: CODEX_AGENT_TYPE,
  description: DESCRIPTION,
  background: true,
  status: 'running',
  ...more,
});

/** A state with these children spawned and running. */
function running(...ids: string[]) {
  const subagents = newCollabState();
  collabEvents(collab('spawn_agent', 'completed', ids), subagents);
  return subagents;
}

describe('collabEvents: spawn_agent', () => {
  it('starts nothing until the spawn names its thread, then a running subagent in the background', () => {
    const subagents = newCollabState();
    expect(collabEvents(collab('spawn_agent', 'in_progress'), subagents)).toEqual([]);
    const events = collabEvents(
      collab('spawn_agent', 'completed', [CHILD_A], { [CHILD_A]: state('pending_init') }),
      subagents,
    );
    expect(events).toEqual([subagent(CHILD_A)]);
    for (const event of events) expect(TurnEvent.parse(event)).toEqual(event);
    expect(collabEvents(collab('spawn_agent', 'completed', [CHILD_A]), subagents)).toEqual([]);
  });

  it('starts one subagent per thread a spawn names, skipping ids that are no event id', () => {
    const events = collabEvents(
      collab('spawn_agent', 'completed', [CHILD_A, CHILD_B, '', 7, 'x'.repeat(201)]),
      newCollabState(),
    );
    expect(events).toEqual([subagent(CHILD_A), subagent(CHILD_B)]);
  });

  it('describes it by its prompt’s first line, or not at all without a prompt', () => {
    const none = collab('spawn_agent', 'completed', [CHILD_A], {}, null);
    expect(collabEvents(none, newCollabState())).toEqual([subagent(CHILD_A, { description: '' })]);
    const long = collab('spawn_agent', 'completed', [CHILD_A], {}, 'y'.repeat(300));
    const [event] = collabEvents(long, newCollabState());
    expect(event).toMatchObject({ description: `${'y'.repeat(199)}…` });
  });

  it('a failed spawn that names no thread is a failed tool line; one that names it, a failed subagent', () => {
    expect(collabEvents(collab('spawn_agent', 'failed'), newCollabState())).toEqual([
      { type: 'tool', id: 'item_spawn_agent', name: 'spawn_agent', summary: DESCRIPTION },
      { type: 'tool_result', id: 'item_spawn_agent', ok: false, summary: 'Codex could not spawn agent.' },
    ]);
    const named = collab('spawn_agent', 'failed', [CHILD_A], {
      [CHILD_A]: state('errored', 'Too many agents.'),
    });
    expect(collabEvents(named, newCollabState())).toEqual([
      subagent(CHILD_A, { status: 'failed', summary: 'Too many agents.' }),
    ]);
    expect(collabEvents({ ...collab('spawn_agent', 'failed'), id: undefined }, newCollabState())).toEqual([]);
  });
});

describe('collabEvents: wait, send_input, close_agent', () => {
  it('a wait that completes ends each child as its state says, with its message as the answer', () => {
    const subagents = running(CHILD_A, CHILD_B, CHILD_C);
    expect(collabEvents(collab('wait', 'in_progress', [CHILD_A, CHILD_B, CHILD_C]), subagents)).toEqual([]);
    const events = collabEvents(
      collab('wait', 'completed', [CHILD_A, CHILD_B, CHILD_C], {
        [CHILD_A]: state('completed', 'Slept 41 seconds.'),
        [CHILD_B]: state('errored', '  python3: not found  '),
        [CHILD_C]: state('running'),
      }),
      subagents,
    );
    expect(events).toEqual([
      subagent(CHILD_A, { status: 'done', summary: 'Slept 41 seconds.' }),
      subagent(CHILD_B, { status: 'failed', summary: 'python3: not found' }),
    ]);
  });

  it('maps every Codex status, and keeps one that ended as it ended', () => {
    const subagents = running(CHILD_A, CHILD_B, CHILD_C);
    const events = collabEvents(
      collab('close_agent', 'completed', [], {
        [CHILD_A]: state('shutdown'),
        [CHILD_B]: state('not_found'),
        [CHILD_C]: state('interrupted'),
        unknown: state('completed'),
      }),
      subagents,
    );
    expect(events.map((event) => event.type === 'subagent' && event.status)).toEqual([
      'interrupted',
      'failed',
      'interrupted',
    ]);
    const again = collab('wait', 'completed', [], { [CHILD_A]: state('completed', 'late'), [CHILD_B]: 'x' });
    expect(collabEvents(again, subagents)).toEqual([]);
  });

  it('ignores a state with no status Codex has, and a message-less end has no answer', () => {
    const subagents = running(CHILD_A);
    expect(
      collabEvents(collab('wait', 'completed', [], { [CHILD_A]: state('thinking') }), subagents),
    ).toEqual([]);
    expect(
      collabEvents(collab('wait', 'completed', [], { [CHILD_A]: state('completed', ' ') }), subagents),
    ).toEqual([subagent(CHILD_A, { status: 'done' })]);
  });

  it('a failed call is a failed tool line, its subagents untouched', () => {
    const subagents = running(CHILD_A);
    expect(collabEvents(collab('send_input', 'failed', [CHILD_A]), subagents)).toEqual([
      { type: 'tool', id: 'item_send_input', name: 'send_input', summary: '' },
      { type: 'tool_result', id: 'item_send_input', ok: false, summary: 'Codex could not send input.' },
    ]);
    const [tool] = collabEvents({ ...collab('wait', 'failed'), tool: undefined }, subagents);
    expect(tool).toMatchObject({ type: 'tool', name: 'collab' });
  });

  it('gives nothing for another item', () => {
    expect(collabEvents({ type: 'command_execution', status: 'failed' }, newCollabState())).toEqual([]);
  });
});

describe('reading a subagent and ending the turn', () => {
  const child: CodexChild = { model: 'gpt-5.5', role: 'explorer', lastStep: 'Ran python3 wait.py' };

  it('reads a subagent once it ends: its model, its role as its type, its last command', () => {
    const asked: string[] = [];
    const readChild: ReadChild = (id) => {
      asked.push(id);
      return id === CHILD_A ? child : id === CHILD_B ? {} : undefined;
    };
    const subagents = newCollabState();
    collabEvents(collab('spawn_agent', 'completed', [CHILD_A, CHILD_B, CHILD_C]), subagents, readChild);
    expect(asked).toEqual([]);
    const events = collabEvents(
      collab('wait', 'completed', [], {
        [CHILD_A]: state('completed', 'Slept.'),
        [CHILD_B]: state('completed'),
      }),
      subagents,
      readChild,
    );
    expect(events).toEqual([
      subagent(CHILD_A, {
        agentType: 'Codex explorer',
        model: 'gpt-5.5',
        lastStep: 'Ran python3 wait.py',
        status: 'done',
        summary: 'Slept.',
      }),
      subagent(CHILD_B, { status: 'done' }),
    ]);
    expect(endedSubagents(subagents, readChild)).toEqual([subagent(CHILD_C, { status: 'interrupted' })]);
    expect(asked).toEqual([CHILD_A, CHILD_B, CHILD_C]);
    expect(endedSubagents(subagents, readChild)).toEqual([]);
  });

  it('reads one that a spawn already reports ended', () => {
    const named = collab('spawn_agent', 'completed', [CHILD_A], { [CHILD_A]: state('completed', 'Done.') });
    expect(collabEvents(named, newCollabState(), () => child)).toEqual([
      subagent(CHILD_A, {
        agentType: 'Codex explorer',
        model: 'gpt-5.5',
        lastStep: 'Ran python3 wait.py',
        status: 'done',
        summary: 'Done.',
      }),
    ]);
  });

  it('ends the running ones as interrupted when the turn ends, read or not', () => {
    const subagents = running(CHILD_A, CHILD_B);
    collabEvents(collab('wait', 'completed', [], { [CHILD_A]: state('completed', 'Slept.') }), subagents);
    expect(endedSubagents(subagents)).toEqual([subagent(CHILD_B, { status: 'interrupted' })]);
    expect(endedSubagents(newCollabState())).toEqual([]);
  });

  it('a reading that throws is no reading', () => {
    const subagents = running(CHILD_A);
    const events = endedSubagents(subagents, () => {
      throw new Error('EACCES');
    });
    expect(events).toEqual([subagent(CHILD_A, { status: 'interrupted' })]);
  });
});
