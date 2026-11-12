import { ACCESS_PROFILE_NAME, defaultRights, type ToolRights } from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { NewAccessProfile, Subscription } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { SelectField, TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { PROVIDER_STYLES } from './Providers.tsx';
import { subscriptionOptions } from './profile-options.ts';
import { ToolRightsFields } from './ToolRightsFields.tsx';

interface FormProps {
  readonly provider: ToolProvider;
  readonly subscriptions: readonly Subscription[];
  readonly create: (profile: NewAccessProfile) => Promise<unknown>;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}

/** What the form holds, and its submit: the profile as `POST` takes it, with its sign-in and rights. */
function useNewToolProfile(provider: ToolProvider, create: FormProps['create']) {
  const [name, setName] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [rights, setRights] = useState<ToolRights>(() => defaultRights(provider));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await create({ name: name.trim(), provider, credentialId: credentialId || null, rights });
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return { name, setName, credentialId, setCredentialId, rights, setRights, busy, error, submit };
}

/**
 * New profile's second step for a tool (S7.1b): its name, one of the person's sign-ins of that tool, and its rights,
 * starting at the safe end. Labels only; with no sign-in yet, a link to add one.
 */
export function ToolProfileFields({ provider, subscriptions, create, onBack, onCancel }: FormProps) {
  const form = useNewToolProfile(provider, create);
  const style = PROVIDER_STYLES[provider];
  const choices = subscriptionOptions(provider, subscriptions, null, 'None for now');
  const addHref = usePersonalHref('subscriptions');
  return (
    <form onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile icon={style.icon} size="md" />
        <h2 className="text-md font-bold text-ink">New {style.name} profile</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
          required
          autoFocus
          maxLength={ACCESS_PROFILE_NAME.max}
          placeholder={provider === 'github' ? 'AiriaLLC push' : 'Jira read'}
          error={form.error}
        />
        <SelectField
          label="Sign-in"
          value={form.credentialId}
          options={choices}
          onChange={(event) => form.setCredentialId(event.target.value)}
          hint={
            choices.length <= 1 && (
              <Link to={addHref} className="font-semibold text-blue hover:underline">
                Add a sign-in
              </Link>
            )
          }
        />
      </div>
      <ToolRightsFields rights={form.rights} onChange={form.setRights} disabled={form.busy} />
      <div className="flex flex-wrap justify-between gap-2">
        <Button tone="quiet" icon={ArrowLeft} disabled={form.busy} onClick={onBack}>
          Other provider
        </Button>
        <div className="flex gap-2">
          <Button tone="quiet" disabled={form.busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" busy={form.busy} disabled={form.name.trim() === ''}>
            Create profile
          </Button>
        </div>
      </div>
    </form>
  );
}
