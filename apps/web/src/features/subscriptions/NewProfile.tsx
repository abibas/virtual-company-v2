import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { NewAccessProfile, Subscription } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { SelectField, TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { PROVIDER_STYLES, ProviderChoice } from './Providers.tsx';
import { gatewayOptions, hasGateway, subscriptionOptions } from './profile-options.ts';
import { type Runs, RunsFields } from './RunsFields.tsx';

/** The hint under the subscription select: what it is for, or where to add one of the provider's. */
function SubscriptionHint({
  provider,
  count,
}: {
  readonly provider: ProfileProvider;
  readonly count: number;
}) {
  const addHref = usePersonalHref('subscriptions', true);
  if (count > 1) return <>The {PROVIDER_STYLES[provider].agents} you give it run on this subscription.</>;
  return (
    <>
      You have no {PROVIDER_STYLES[provider].name} subscription yet.{' '}
      <Link to={addHref} className="font-semibold text-blue hover:underline">
        Add a subscription
      </Link>
    </>
  );
}

/** The profile's optional gateway (any of the person's), with where to add one when the person has none. */
function GatewayField({
  subscriptions,
  value,
  onChange,
}: {
  readonly subscriptions: readonly Subscription[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const addGatewayHref = usePersonalHref('gateways', true);
  return (
    <SelectField
      label="Gateway"
      value={value}
      options={gatewayOptions(subscriptions)}
      onChange={(event) => onChange(event.target.value)}
      hint={
        hasGateway(subscriptions) ? (
          'Optional: where its runs send their AI requests'
        ) : (
          <>
            Optional; you have none.{' '}
            <Link to={addGatewayHref} className="font-semibold text-blue hover:underline">
              Add a gateway
            </Link>
          </>
        )
      }
    />
  );
}

interface FormProps {
  readonly provider: ProfileProvider;
  readonly subscriptions: readonly Subscription[];
  readonly create: (profile: NewAccessProfile) => Promise<unknown>;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}

/** What the form holds, and its submit: the profile as `POST` takes it, with its optional gateway, model and effort. */
function useNewProfile(provider: ProfileProvider, create: FormProps['create']) {
  const [name, setName] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [gatewayCredentialId, setGateway] = useState('');
  const [runs, setRuns] = useState<Runs>({ model: null, effort: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await create({
        name: name.trim(),
        provider,
        credentialId: credentialId || null,
        gatewayCredentialId: gatewayCredentialId || null,
        ...runs,
      });
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return {
    name,
    setName,
    credentialId,
    setCredentialId,
    gatewayCredentialId,
    setGateway,
    runs,
    changeRuns: (change: Partial<Runs>) => setRuns((current) => ({ ...current, ...change })),
    busy,
    error,
    submit,
  };
}

/** The second step: its name, its subscription of the provider, an optional gateway, and its model and effort. */
function ProfileFields({ provider, subscriptions, create, onBack, onCancel }: FormProps) {
  const form = useNewProfile(provider, create);
  const style = PROVIDER_STYLES[provider];
  const choices = subscriptionOptions(provider, subscriptions, null, 'None for now');
  return (
    <form onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile icon={style.icon} size="md" />
        <div className="min-w-0">
          <h2 className="text-md font-bold text-ink">New {style.name} profile</h2>
          <p className="text-sm text-dim">For {style.agents}.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Name"
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
          required
          autoFocus
          maxLength={ACCESS_PROFILE_NAME.max}
          placeholder={provider === 'claude' ? 'Work' : 'Work · OpenAI'}
          error={form.error}
        />
        <SelectField
          label="Subscription"
          value={form.credentialId}
          options={choices}
          onChange={(event) => form.setCredentialId(event.target.value)}
          hint={<SubscriptionHint provider={provider} count={choices.length} />}
        />
        <GatewayField
          subscriptions={subscriptions}
          value={form.gatewayCredentialId}
          onChange={form.setGateway}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <RunsFields provider={provider} runs={form.runs} onChange={form.changeRuns} live />
      </div>
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

/**
 * New profile, on its own card above the list: the provider first (two big choices; `provider` preselects one, as
 * "Make one" on an agent's form does), then its name, its subscription, a gateway, and the model and effort its runs
 * use (the provider's defaults until chosen). A refusal (a name taken) shows on the form.
 */
export function NewProfileForm({
  provider: preselected,
  subscriptions,
  create,
  onCancel,
}: {
  readonly provider?: ProfileProvider | undefined;
  readonly subscriptions: readonly Subscription[];
  /** Creates it (`POST`) and closes this card. */
  readonly create: (profile: NewAccessProfile) => Promise<unknown>;
  readonly onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ProfileProvider | undefined>(preselected);
  return (
    <Card as="section" aria-label="New profile" className="mb-5">
      {provider === undefined ? (
        <ProviderChoice onChoose={setProvider} onCancel={onCancel} />
      ) : (
        <ProfileFields
          key={provider}
          provider={provider}
          subscriptions={subscriptions}
          create={create}
          onBack={() => setProvider(undefined)}
          onCancel={onCancel}
        />
      )}
    </Card>
  );
}
