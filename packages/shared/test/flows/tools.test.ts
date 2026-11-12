import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_TOOL_INFO,
  AGENT_TOOL_INPUTS,
  AgentTool,
  AgentToolName,
  AttachInput,
  isDecisionTool,
  LEAD_TOOLS,
  leadSection,
  STEP_TOOLS,
  stepTools,
} from '../../src/flows.ts';

describe('which tools a turn gets', () => {
  it('a step’s turn: read, its kind’s moves, attach and blocked', () => {
    expect(stepTools('work')).toEqual(['task_read', 'task_hand_on', 'task_attach', 'task_blocked']);
    expect(stepTools('check')).toEqual([
      'task_read',
      'task_pass',
      'task_send_back',
      'task_attach',
      'task_blocked',
    ]);
    expect(stepTools('signoff')).toEqual([
      'task_read',
      'task_approve',
      'task_send_back',
      'task_attach',
      'task_blocked',
    ]);
  });

  it('every tool has its input and its words; the moves are decisions, the reads and the Lead’s are not', () => {
    for (const tool of AgentTool.options) {
      expect(AGENT_TOOL_INPUTS[tool]).toBeDefined();
      expect(AGENT_TOOL_INFO[tool].description.length).toBeGreaterThan(20);
      expect(z.toJSONSchema(AGENT_TOOL_INPUTS[tool], { io: 'input', unrepresentable: 'any' })).toMatchObject({
        type: 'object',
      });
    }
    expect(STEP_TOOLS.filter(isDecisionTool)).toEqual([
      'task_hand_on',
      'task_pass',
      'task_approve',
      'task_send_back',
      'task_blocked',
    ]);
    expect(LEAD_TOOLS.some(isDecisionTool)).toBe(false);
  });

  it('a tool’s name on the wire: one lower-case word, so a newer one parses', () => {
    expect(AgentToolName.safeParse('task_review_later').success).toBe(true);
    expect(AgentToolName.safeParse('Task').success).toBe(false);
    expect(AgentToolName.safeParse('mcp__mwc__x y').success).toBe(false);
  });
});

describe('the tools’ inputs', () => {
  it('a hand-off needs its summary; a send-back its reason and findings; a key is a task key', () => {
    expect(AGENT_TOOL_INPUTS.task_hand_on.safeParse({ summary: '  Done ' }).data).toEqual({
      summary: 'Done',
    });
    expect(AGENT_TOOL_INPUTS.task_hand_on.safeParse({ summary: ' ' }).success).toBe(false);
    expect(AGENT_TOOL_INPUTS.task_send_back.safeParse({ reason: 'x' }).success).toBe(false);
    expect(AGENT_TOOL_INPUTS.task_show.safeParse({ key: 't-12' }).success).toBe(true);
    expect(AGENT_TOOL_INPUTS.task_show.safeParse({ key: 'T-0' }).success).toBe(false);
    expect(AGENT_TOOL_INPUTS.task_create.safeParse({ title: 'x', priority: 'soon' }).success).toBe(false);
    expect(AGENT_TOOL_INPUTS.task_read.safeParse({ extra: 1 }).data).toEqual({});
  });

  it('an attachment is exactly one of a note, a file or a link; a note and a link are named', () => {
    const issues = (input: unknown) => AttachInput.safeParse(input).error?.issues.map((i) => i.message) ?? [];
    expect(issues({ name: 'Plan', text: 'a' })).toEqual([]);
    expect(issues({ path: 'shots/login.png' })).toEqual([]);
    expect(issues({ name: 'PR', url: 'https://github.test/pull/1' })).toEqual([]);
    expect(issues({ name: 'x' })).toEqual(['give exactly one of text, path or url']);
    expect(issues({ text: 'a', path: 'a.md' })).toEqual(['give exactly one of text, path or url']);
    expect(issues({ url: 'https://x.test' })).toEqual(['a note or a link needs a name']);
    expect(issues({ name: 'Hand-off note', text: 'a' })).toEqual(['"hand-off note" is the step\'s own']);
    expect(issues({ path: '../up.md' }).length).toBe(1);
    expect(issues({ name: 'x', url: 'ftp://x.test' }).length).toBe(1);
  });
});

describe('the Lead’s section', () => {
  it('names its flow and its tools, briefly', () => {
    const text = leadSection('  DEVBOX\n delivery ');
    expect(text).toMatch(
      /^## Leading your team \(from Most Wanted\)\n\nYou lead the flow "DEVBOX delivery"\./,
    );
    for (const tool of LEAD_TOOLS) expect(text).toContain(tool);
    expect(text.length).toBeLessThan(1_200);
  });

  it('tells it never to wait inside a turn, nor to do a step’s work', () => {
    const text = leadSection('DEVBOX delivery');
    expect(text).toContain('Never wait or poll for a step’s agent inside your turn');
    expect(text).toContain('end your turn: Most Wanted wakes you in your team chat when a task needs you');
    expect(text).toContain('regular check-ins');
    expect(text).toContain('Never edit a step’s files or artifacts');
  });
});
