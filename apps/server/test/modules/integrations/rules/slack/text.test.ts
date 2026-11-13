import { describe, expect, it } from 'vitest';
import { postIcon } from '../../../../../src/modules/integrations/rules/slack/icons.ts';
import {
  footerText,
  postBlocks,
  postName,
  SECTION_MAX,
  sections,
  stripMentions,
} from '../../../../../src/modules/integrations/rules/slack/text.ts';

describe('a Slack post’s text', () => {
  it('loses every mention of many people, keeping the word and a person’s mention', () => {
    expect(stripMentions('<!here|@here> hi <!channel> and <!everyone>')).toEqual({
      text: 'here hi channel and everyone',
      stripped: ['@here', '@channel', '@everyone'],
    });
    expect(stripMentions('@here now, @Channel! email a@everyone.com <@U1>')).toEqual({
      text: 'here now, Channel! email a@everyone.com <@U1>',
      stripped: ['@here', '@channel'],
    });
    expect(stripMentions('<!subteam^S01|@devs> <!subteam^S02>')).toEqual({
      text: 'devs group',
      stripped: ['@devs', '@group'],
    });
    expect(stripMentions('plain')).toEqual({ text: 'plain', stripped: [] });
  });

  it('goes in sections of at most 3000 characters, cut at a line break when it can be', () => {
    expect(sections('short')).toEqual(['short']);
    expect(sections('')).toEqual([]);
    const lines = sections(`${'a'.repeat(2000)}\n${'b'.repeat(2000)}`);
    expect(lines).toEqual(['a'.repeat(2000), 'b'.repeat(2000)]);
    const one = sections('c'.repeat(SECTION_MAX + 5));
    expect(one.map((piece) => piece.length)).toEqual([SECTION_MAX, 5]);
  });

  it('ends with the footer naming the agent, on one line', () => {
    expect(footerText(' QA\n bot ')).toBe('via Most Wanted · QA bot');
    expect(postBlocks('Hi', 'QA')).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Hi' } },
      { type: 'context', elements: [{ type: 'plain_text', text: 'via Most Wanted · QA', emoji: true }] },
    ]);
    expect(postName(`  ${'n'.repeat(100)}`)).toHaveLength(80);
  });

  it('shows an emoji icon by its Slack name when it knows it, else the app’s own', () => {
    expect(postIcon({ iconKind: 'emoji', iconEmoji: '🤖' })).toEqual({ iconEmoji: ':robot_face:' });
    expect(postIcon({ iconKind: 'emoji', iconEmoji: '🛠️' })).toEqual({ iconEmoji: ':hammer_and_wrench:' });
    expect(postIcon({ iconKind: 'emoji', iconEmoji: '🫠' })).toEqual({});
    expect(postIcon({ iconKind: 'face', iconEmoji: null })).toEqual({});
    expect(postIcon({ iconKind: 'image', iconEmoji: null })).toEqual({});
  });
});
