import { describe, expect, it } from 'vitest';
import {
  addressedAgent,
  afterBotMention,
  askedText,
  mentionedIds,
  renderSlackText,
} from '../../../../../../src/modules/integrations/rules/slack/inbound/text.ts';

/** A Slack message's text as an agent reads it (2026-11-13), and the agent it addresses. */

const AGENTS = [
  { name: 'Developer', slug: 'developer' },
  { name: 'TEST DEV', slug: 'test-dev' },
  { name: 'TEST', slug: 'test' },
];

describe('the text', () => {
  it('renders mentions, channels, special mentions, groups, dates and links, and decodes entities', () => {
    const names = new Map([['U0IHOR', 'Ihor Herasko']]);
    const text =
      '<@U0IHOR> <@U0X> <@U0Y|anna> in <#C1|general> <#C2> <!here> <!subteam^S1|@devs> <!subteam^S2> ' +
      '<!date^1|Nov 13> <!date^2> see <https://x.test|the doc> <https://y.test> <mailto:a@b.test|a@b.test> ' +
      '<mailto:c@d.test> 1 &lt; 2 &amp;&amp; 3 &gt; 2';
    expect(renderSlackText(text, names)).toBe(
      '@Ihor Herasko @U0X @anna in #general #C2 @here @devs @group Nov 13  see the doc (https://x.test) ' +
        'https://y.test a@b.test c@d.test 1 < 2 && 3 > 2',
    );
    expect(mentionedIds('<@U0IHOR> <@U0IHOR> <@U0Y|anna> <@W0ENT>')).toEqual(['U0IHOR', 'W0ENT']);
  });
});

describe('the agent it addresses', () => {
  it('is named right after the bot’s mention, by name or slug, any case, the longest that fits', () => {
    expect(addressedAgent('<@U0BOT> @developer hi', 'U0BOT', AGENTS)?.name).toBe('Developer');
    expect(addressedAgent('hey <@U0BOT|mw-bot> @TEST DEV, run it', 'U0BOT', AGENTS)?.name).toBe('TEST DEV');
    expect(addressedAgent('<@U0BOT> @test-dev', 'U0BOT', AGENTS)?.name).toBe('TEST DEV');
    expect(addressedAgent('<@U0BOT> @test it', 'U0BOT', AGENTS)?.name).toBe('TEST');
    expect(addressedAgent('@Developer in a DM', null, AGENTS)?.name).toBe('Developer');
  });

  it('is none without an @ right after the mention, or with a name that does not end there', () => {
    expect(addressedAgent('<@U0BOT> hi @Developer', 'U0BOT', AGENTS)).toBeUndefined();
    expect(addressedAgent('<@U0BOT> @Developers', 'U0BOT', AGENTS)).toBeUndefined();
    expect(addressedAgent('<@U0BOT> @', 'U0BOT', [{ name: '', slug: '' }])).toBeUndefined();
  });

  it('leaves what is asked, for a title', () => {
    expect(afterBotMention('no mention here ', 'U0BOT')).toBe('no mention here');
    expect(askedText('<@U0BOT> @Developer fix the build', 'U0BOT', 'Developer')).toBe('fix the build');
    expect(askedText('<@U0BOT> fix the build', 'U0BOT', null)).toBe('fix the build');
    expect(askedText('<@U0BOT> @dev fix', 'U0BOT', 'Developer')).toBe('@dev fix');
  });
});
