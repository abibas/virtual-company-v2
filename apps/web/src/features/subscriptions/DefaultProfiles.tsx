import { PROFILE_PROVIDERS } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { useId, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { ProfileCalls } from '../../api/subscriptions.ts';
import type { AccessProfile, Membership } from '../../api/types.ts';
import { Select } from '../../components/forms/Input.tsx';
import { roleName } from '../../components/ui/Badge.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

import { profilesOf } from './profile-options.ts';

interface DefaultsProps {
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly calls: ProfileCalls;
  /** Saved: read the person's memberships again, which carry the defaults. */
  readonly onChanged: () => Promise<unknown>;
}

/** Each default's label: the agents it is for. */
const DEFAULT_LABELS: Readonly<Record<ProfileProvider, string>> = {
  claude: 'Claude Code agents',
  openai: 'Codex agents',
};

/** The membership's default of each provider. */
const DEFAULTS: Readonly<Record<ProfileProvider, (m: Membership) => string | null>> = {
  claude: (m) => m.defaultClaudeProfileId,
  openai: (m) => m.defaultOpenaiProfileId,
};

/** One company's default of one provider, saved as soon as it changes; only that provider's profiles are offered. */
function DefaultSelect({
  membership,
  provider,
  profiles,
  calls,
  onChanged,
}: DefaultsProps & { readonly membership: Membership; readonly provider: ProfileProvider }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (value: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await calls.setDefault(membership.companyId, provider, value || null);
      await onChanged();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const options = [
    { value: '', label: 'None' },
    ...profilesOf(profiles ?? [], provider).map((p) => ({ value: p.id, label: p.name })),
  ];
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-dim">
        {DEFAULT_LABELS[provider]}
      </label>
      <Select
        id={id}
        size="sm"
        value={DEFAULTS[provider](membership) ?? ''}
        disabled={busy || profiles === undefined}
        options={options}
        onChange={(event) => void change(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/** One company's row: its name, the person's role there, and the default of each provider. */
function DefaultRow({ membership, ...rest }: DefaultsProps & { readonly membership: Membership }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{membership.name}</span>
        <span className="text-xs text-dim">You are {roleName(membership.role).toLowerCase()} there</span>
      </div>
      <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 sm:[&>*]:w-56">
        {PROFILE_PROVIDERS.map((provider) => (
          <DefaultSelect key={provider} membership={membership} provider={provider} {...rest} />
        ))}
      </div>
    </li>
  );
}

/** "Defaults for agents I hire": per company where the person is an admin or owner, a Claude and an OpenAI default. */
export function DefaultProfiles({
  memberships,
  ...rest
}: DefaultsProps & { readonly memberships: readonly Membership[] }) {
  const companies = memberships.filter((m) => m.status === 'active' && roleAtLeast(m.role, 'admin'));
  if (companies.length === 0) return null;
  return (
    <Panel
      title="Defaults for agents I hire"
      description="A Claude Code agent you hire gets your Claude default, a Codex agent your OpenAI default, unless you choose another on the hire form."
      className="mt-5"
    >
      <ul className="divide-y divide-line">
        {companies.map((membership) => (
          <DefaultRow key={membership.companyId} membership={membership} {...rest} />
        ))}
      </ul>
    </Panel>
  );
}
