import { describe, expect, it } from 'vitest';
import { postIcon } from '../../../../../src/modules/integrations/rules/slack/icons.ts';
import { postName, stripMentions } from '../../../../../src/modules/integrations/rules/slack/text.ts';

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

  it('shows the agent’s name on one line, cut at 80 characters', () => {
    expect(postName(' QA\n bot ')).toBe('QA bot');
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
