/**
 * An agent's icon on its Slack posts (S7.1e, with `chat:write.customize`): Slack takes an emoji by its name
 * (`:robot_face:`) or an image by a public address. Agents' uploaded images are behind sign-in, so none has a public
 * address yet; an emoji icon is sent by its Slack name when it is one of these, else the post keeps the app's icon.
 */

/** Common emoji by their Slack names. */
const NAMES: Readonly<Record<string, string>> = {
  '🤖': 'robot_face',
  '🦊': 'fox_face',
  '🐱': 'cat',
  '🐶': 'dog',
  '🐼': 'panda_face',
  '🐧': 'penguin',
  '🦉': 'owl',
  '🐝': 'bee',
  '🐙': 'octopus',
  '🦄': 'unicorn_face',
  '🦁': 'lion_face',
  '🐯': 'tiger',
  '🐸': 'frog',
  '🐢': 'turtle',
  '👾': 'space_invader',
  '👀': 'eyes',
  '🧠': 'brain',
  '🚀': 'rocket',
  '🧪': 'test_tube',
  '🔍': 'mag',
  '🛠': 'hammer_and_wrench',
  '🔧': 'wrench',
  '🧰': 'toolbox',
  '⚙': 'gear',
  '🐛': 'bug',
  '📊': 'bar_chart',
  '📝': 'memo',
  '📦': 'package',
  '📣': 'mega',
  '💬': 'speech_balloon',
  '💡': 'bulb',
  '🔥': 'fire',
  '⭐': 'star',
  '🎯': 'dart',
  '✅': 'white_check_mark',
  '🛡': 'shield',
  '🧹': 'broom',
  '🧑‍💻': 'technologist',
  '👷': 'construction_worker',
  '🕵': 'sleuth_or_spy',
};

/** What a post shows as the agent's icon: an emoji by its Slack name, or nothing (the app's own icon). */
export function postIcon(agent: { readonly iconKind: string; readonly iconEmoji: string | null }): {
  readonly iconEmoji?: string;
} {
  if (agent.iconKind !== 'emoji' || agent.iconEmoji === null) return {};
  const name = NAMES[agent.iconEmoji.replace(/️/g, '')];
  return name === undefined ? {} : { iconEmoji: `:${name}:` };
}
