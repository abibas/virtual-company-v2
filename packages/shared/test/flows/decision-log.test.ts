import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DecisionOutcome } from '../../src/enums.ts';
import {
  AGENT_TOOL_INFO,
  AGENT_TOOL_INPUTS,
  AgentTool,
  checkToolInput,
  DECISION_LIMITS,
  DECISION_LINE,
  DECISION_TOOL,
  isDecisionTool,
  READ_TOOLS,
  RecordDecisionInput,
  stepTools,
} from '../../src/flows.ts';

/** The decision log's tool (2026-11-14): its name among the agents' tools, its input, its words and its line. */

describe('record_decision', () => {
  it('is an agents’ tool of its own: not a step’s move, not a read, in no step’s list', () => {
    expect(AgentTool.options).toContain(DECISION_TOOL);
    expect(DECISION_TOOL).toBe('record_decision');
    expect(isDecisionTool(DECISION_TOOL)).toBe(false);
    expect(READ_TOOLS).not.toContain(DECISION_TOOL);
    expect(stepTools('check')).not.toContain(DECISION_TOOL);
    expect(AGENT_TOOL_INPUTS.record_decision).toBe(RecordDecisionInput);
    expect(AGENT_TOOL_INFO.record_decision.title).toBe('Record a decision');
  });

  it('takes what, why, sources and an outcome; what is one line, the rest trimmed', () => {
    const checked = checkToolInput('record_decision', {
      what: '  Approve PR\n  #12 ',
      why: ' It passes the checks and the tests. ',
      sources: [' https://github.com/acme/app/pull/12 ', 'SS-2887', 'src/app.ts'],
      outcome: 'approved',
    });
    expect(checked).toEqual({
      ok: true,
      input: {
        what: 'Approve PR #12',
        why: 'It passes the checks and the tests.',
        sources: ['https://github.com/acme/app/pull/12', 'SS-2887', 'src/app.ts'],
        outcome: 'approved',
      },
    });
    expect(checkToolInput('record_decision', { what: 'Decline', why: 'Out of scope.' })).toEqual({
      ok: true,
      input: { what: 'Decline', why: 'Out of scope.' },
    });
  });

  it('refuses a missing or over-long part, too many sources and an unknown outcome, saying where', () => {
    const tooLong = checkToolInput('record_decision', {
      what: 'x'.repeat(DECISION_LIMITS.what + 1),
      why: 'y'.repeat(DECISION_LIMITS.why + 1),
      sources: Array.from({ length: DECISION_LIMITS.sources + 1 }, (_, i) => `s${i}`),
      outcome: 'maybe',
    });
    expect(tooLong.ok).toBe(false);
    const error = tooLong.ok ? '' : tooLong.error;
    expect(error).toMatch(/^record_decision did nothing; fix its input and call it again:/);
    for (const where of ['what:', 'why:', 'sources:', 'outcome:']) expect(error).toContain(where);
    const empty = checkToolInput('record_decision', { what: ' ', why: '', sources: [''] });
    expect(empty.ok ? '' : empty.error).toContain('sources.0:');
    expect(checkToolInput('record_decision', undefined).ok).toBe(false);
  });

  it('every outcome is the enum’s; the input reads as JSON Schema for the tools list', () => {
    expect(DecisionOutcome.options).toEqual([
      'approved',
      'rejected',
      'done',
      'declined',
      'deferred',
      'other',
    ]);
    const schema = z.toJSONSchema(RecordDecisionInput, { io: 'input', unrepresentable: 'any' });
    expect(schema).toMatchObject({
      type: 'object',
      required: ['what', 'why'],
      properties: { outcome: { enum: DecisionOutcome.options } },
    });
  });

  it('its standing line is one short line naming the tool and when to call it', () => {
    expect(DECISION_LINE).not.toContain('\n');
    expect(DECISION_LINE.length).toBeLessThan(300);
    expect(DECISION_LINE).toContain('record_decision');
    expect(DECISION_LINE).toContain('never for routine steps');
  });
});
