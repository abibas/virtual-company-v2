import { describe, expect, it } from 'vitest';
import { AGENT_EMOJI_MAX, agentIconView, isAgentEmoji } from '../src/agent-icons.ts';
import { AgentIconContentType, AgentIconKind } from '../src/enums.ts';

const sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('the agent icon contract', () => {
  it('names the kinds and the image types an icon may be', () => {
    expect(AgentIconKind.options).toEqual(['face', 'emoji', 'image']);
    expect(AgentIconContentType.options).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect(AGENT_EMOJI_MAX).toBe(16);
  });

  it.each([
    ['a pictograph', '🤖'],
    ['one with a variation selector', '❤️'],
    ['a skin tone', '👩🏽'],
    ['a ZWJ sequence', '👩‍💻'],
    ['a family', '👨‍👩‍👧‍👦'],
    ['a flag', '🇺🇦'],
    ['a subdivision flag', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    ['a keycap', '1️⃣'],
    ['a pictographic symbol', '©'],
  ])('takes %s as one emoji', (_, emoji) => {
    expect(isAgentEmoji(emoji)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a letter', 'A'],
    ['a digit', '7'],
    ['two emoji', '🤖🤖'],
    ['an emoji and a letter', '🤖a'],
    ['an emoji with a space', ' 🤖'],
    ['an emoji with a line break', '🤖\n'],
    ['a control character', '\u0007'],
    ['too many code points', `🤖${'́'.repeat(16)}`],
  ])('refuses %s', (_, text) => {
    expect(isAgentEmoji(text)).toBe(false);
  });

  it('shows the emoji, the image by its version, else the face', () => {
    expect(agentIconView('face', null, null)).toEqual({ kind: 'face' });
    expect(agentIconView('emoji', '🤖', null)).toEqual({ kind: 'emoji', emoji: '🤖' });
    expect(agentIconView('image', null, sha256)).toEqual({ kind: 'image', version: '9f86d081884c7d65' });
    expect(agentIconView('emoji', null, sha256)).toEqual({ kind: 'face' });
    expect(agentIconView('image', null, undefined)).toEqual({ kind: 'face' });
  });
});
