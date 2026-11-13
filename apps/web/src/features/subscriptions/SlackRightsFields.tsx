import {
  SLACK_CHANNEL_ID_PATTERN,
  SLACK_CHANNEL_NAME_PATTERN,
  type SlackCapability,
  type SlackDms,
  type SlackRights,
  slackGap,
  slackGapWords,
} from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { Switch } from '../../components/forms/Switch.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';
import { ScopeControl } from './ScopeControl.tsx';
import type { RightsProps } from './ToolRightsFields.tsx';

/** What the Slack rights read of the part's sign-in: its kind and the scopes Slack granted its token. */
export interface SlackSignInFacts {
  readonly kind: CredentialKind;
  readonly scopes?: readonly string[] | undefined;
}

/** A channel as typed: its id as it is, else its name without `#`, lower-case. */
const channelOf = (entry: string) => {
  const bare = entry.trim().replace(/^#/, '');
  return SLACK_CHANNEL_ID_PATTERN.test(bare) ? bare : bare.toLowerCase();
};
const isChannel = (entry: string) =>
  SLACK_CHANNEL_ID_PATTERN.test(entry) || SLACK_CHANNEL_NAME_PATTERN.test(entry);

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A right's switch: it cannot be turned on while the token lacks what it needs (`why`, its tooltip). */
function Gated({
  label,
  checked,
  onChange,
  disabled,
  why,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
  readonly disabled: boolean;
  readonly why: string | undefined;
}) {
  const blocked = !checked && why !== undefined;
  const control = (
    <Switch label={label} checked={checked} disabled={disabled || blocked} onChange={onChange} />
  );
  return why === undefined ? (
    control
  ) : (
    <Tooltip label={why} wrap>
      {control}
    </Tooltip>
  );
}

/**
 * A Slack part's rights (S7.1e): its channels (All, or names and ids as chips), Read, Post, Search and React, and DMs
 * (Off, Read, Post). A right whose scopes the sign-in's token lacks cannot be turned on; its tooltip names the scope
 * (search also needs a user token, and Read).
 */
export function SlackRightsFields({
  rights,
  onChange,
  disabled,
  signIn,
}: RightsProps<SlackRights> & { readonly signIn: SlackSignInFacts | null }) {
  const set = (change: Partial<SlackRights>) => onChange({ ...rights, ...change });
  const why = (capability: SlackCapability) => {
    const gap = signIn === null ? undefined : slackGap(capability, signIn.kind, signIn.scopes ?? []);
    return gap === undefined ? undefined : capital(slackGapWords(gap));
  };
  const dmsWhy = [why('dmsRead') && `Read: ${why('dmsRead')}`, why('dmsPost') && `Post: ${why('dmsPost')}`];
  const levels: readonly SegmentOption<SlackDms>[] = [
    { value: 'off', label: 'Off' },
    { value: 'read', label: 'Read', disabled: rights.dms !== 'read' && why('dmsRead') !== undefined },
    { value: 'post', label: 'Post', disabled: rights.dms !== 'post' && why('dmsPost') !== undefined },
  ];
  const dms = (
    <SegmentedControl
      label="Direct messages"
      size="sm"
      options={levels}
      value={rights.dms}
      onChange={(next) => set({ dms: next })}
      disabled={disabled}
    />
  );
  const dmsTip = dmsWhy.filter((line) => line).join(' · ');
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ChoiceField label="Channels">
        <ScopeControl
          label="Channels"
          all="All channels"
          scope={rights.channels}
          onChange={(channels) => set({ channels })}
          pattern={isChannel}
          normalize={channelOf}
          placeholder="#general, C0123ABCD"
          disabled={disabled}
        />
      </ChoiceField>
      <ChoiceField label="Rights">
        <Gated
          label="Read"
          checked={rights.read}
          disabled={disabled}
          why={why('read')}
          onChange={(read) => set({ read })}
        />
        <Gated
          label="Post"
          checked={rights.post}
          disabled={disabled}
          why={why('post')}
          onChange={(post) => set({ post })}
        />
        <Gated
          label="Search"
          checked={rights.search}
          disabled={disabled}
          why={why('search') ?? (rights.read ? undefined : 'Needs Read')}
          onChange={(search) => set({ search })}
        />
        <Gated
          label="React"
          checked={rights.react}
          disabled={disabled}
          why={why('react')}
          onChange={(react) => set({ react })}
        />
      </ChoiceField>
      <ChoiceField label="DMs">
        {dmsTip === '' ? (
          dms
        ) : (
          <Tooltip label={dmsTip} wrap>
            {dms}
          </Tooltip>
        )}
      </ChoiceField>
    </div>
  );
}
