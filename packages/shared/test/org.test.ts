import { describe, expect, it } from 'vitest';
import {
  AGENT_DEFAULTS,
  AGENT_FACE,
  AGENT_MAX_CONCURRENT_RUNS,
  AGENT_NAME,
  AGENT_ROLE_TITLE,
  agentFace,
  POSITION_TITLE_MAX,
} from '../src/org.ts';

describe('the org chart contract', () => {
  it('holds the limits the agents and org_positions CHECKs hold', () => {
    expect(AGENT_NAME).toEqual({ min: 1, max: 80 });
    expect(AGENT_ROLE_TITLE).toEqual({ min: 1, max: 80 });
    expect(POSITION_TITLE_MAX).toBe(80);
    expect(AGENT_MAX_CONCURRENT_RUNS).toEqual({ min: 1, max: 8 });
    expect(AGENT_FACE).toEqual({ min: 0, max: 41 });
  });

  it('gives a new agent Claude Code, one run at a time and no instructions (its model is its profile’s)', () => {
    expect(AGENT_DEFAULTS).toEqual({
      harness: 'claude_code',
      instructions: '',
      maxConcurrentRuns: 1,
    });
  });

  it('draws the same face for the same slug, always one of the 42', () => {
    // Pinned: the web's form and the server must agree on these for good.
    expect(agentFace('slop-box')).toBe(agentFace('slop-box'));
    expect(agentFace('')).toBe(0x811c9dc5 % 42);
    expect([agentFace('slop-box'), agentFace('code-reviewer'), agentFace('qa')]).toEqual([29, 26, 15]);
    const faces = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const face = agentFace(`agent-${i}`);
      expect(Number.isInteger(face) && face >= AGENT_FACE.min && face <= AGENT_FACE.max).toBe(true);
      faces.add(face);
    }
    // Spread over every face.
    expect(faces.size).toBe(42);
  });
});
