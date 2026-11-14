import { Bot, type LucideIcon } from 'lucide-react';
import { SegmentedControl, type SegmentOption } from '../../../components/forms/Segmented.tsx';
import { SlackMark } from '../../../components/ui/ProviderLogo.tsx';

/**
 * Where a message in a Slack conversation's chat goes (2026-11-14, docs/subscriptions.md "Send in Slack"), for the
 * Slack connection's owner: Ask the agent (a normal turn, as you), or Send in Slack (straight into that conversation,
 * as the bot, with no agent turn). A small segmented choice above the message box.
 */

export type SlackTargetValue = 'agent' | 'slack';

const OPTIONS: readonly SegmentOption<SlackTargetValue>[] = [
  { value: 'agent', label: 'Ask the agent', icon: Bot },
  { value: 'slack', label: 'Send in Slack', icon: SlackMark as unknown as LucideIcon },
];

export function SlackTarget({
  value,
  place,
  onChange,
}: {
  readonly value: SlackTargetValue;
  readonly place: string;
  readonly onChange: (value: SlackTargetValue) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        options={OPTIONS}
        value={value}
        onChange={onChange}
        label="Where the message goes"
        size="sm"
      />
      {value === 'slack' && (
        <span className="text-2xs text-dim">Posted in {place} as the bot; the agent is not asked.</span>
      )}
    </div>
  );
}
