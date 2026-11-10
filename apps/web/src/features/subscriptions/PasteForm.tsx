import {
  CREDENTIAL_LABEL,
  type GatewayProvider,
  type PastedCredentialKind,
  SECRET_PREFIXES,
} from '@mwc/shared/credentials';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { subscriptionCalls } from '../../api/subscriptions.ts';
import type { NewSubscription, Subscription } from '../../api/types.ts';
import { SecretField, TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import {
  GATEWAY_STYLES,
  GatewayAddress,
  GatewayProviderChoice,
  GatewayProviderLine,
  type HeaderRow,
  HeaderRows,
} from './GatewayFields.tsx';

/** What each paste form is called, its starting name, its secret's label and where the secret comes from. */
interface PasteCopy {
  readonly title: string;
  readonly name: string;
  readonly secret: string;
  readonly hint: ReactNode;
}

const COPY: Readonly<Record<PastedCredentialKind, PasteCopy>> = {
  claude_setup_token: {
    title: 'Paste a Claude setup-token',
    name: 'Claude token',
    secret: 'Setup-token',
    hint: (
      <>
        Run <code className="font-mono text-ink-2">claude setup-token</code> and paste what it prints (it
        starts with {SECRET_PREFIXES.claude_setup_token}). It serves inference only and lasts a year.
      </>
    ),
  },
  anthropic_api_key: {
    title: 'Add an Anthropic API key',
    name: 'Anthropic API key',
    secret: 'API key',
    hint: `From the Anthropic Console; it starts with ${SECRET_PREFIXES.anthropic_api_key}. Pay as you go.`,
  },
  openai_api_key: {
    title: 'Add an OpenAI API key',
    name: 'OpenAI API key',
    secret: 'API key',
    hint: `From the OpenAI platform; it starts with ${SECRET_PREFIXES.openai_api_key}. Pay as you go.`,
  },
  gateway: {
    title: 'Add an AI gateway',
    name: 'Gateway',
    secret: 'Headers',
    hint: 'Whose requests it takes, the address runs send them to, and the headers it needs with each one.',
  },
};

/** The names a gateway starts with: a choice of provider names it after the provider unless the person renamed it. */
const STARTING_NAMES: readonly string[] = [
  COPY.gateway.name,
  ...Object.values(GATEWAY_STYLES).map((style) => style.name),
];

/** The sheet's title for a paste form. */
export const pasteTitle = (kind: PastedCredentialKind): string => COPY[kind].title;

/** What the form holds: a name, and a secret or a gateway's provider (asked first), address and headers. */
interface PasteValues {
  readonly label: string;
  readonly secret: string;
  readonly provider: GatewayProvider | undefined;
  readonly baseUrl: string;
  readonly headers: readonly HeaderRow[];
}

/** What `POST /api/me/subscriptions` takes for this form. */
function bodyOf(kind: PastedCredentialKind, values: PasteValues): NewSubscription {
  const label = values.label.trim();
  const secret = values.secret.trim();
  const named = values.headers.filter((row) => row.name.trim() !== '');
  const headers = Object.fromEntries(named.map((row) => [row.name.trim(), row.value]));
  if (kind === 'claude_setup_token') return { kind, label, token: secret };
  if (kind === 'gateway') {
    return { kind, label, provider: values.provider ?? 'anthropic', baseUrl: values.baseUrl.trim(), headers };
  }
  return { kind, label, apiKey: secret };
}

/** True when the form has all the API needs. */
const isReady = (kind: PastedCredentialKind, values: PasteValues): boolean =>
  values.label.trim() !== '' &&
  (kind === 'gateway'
    ? values.provider !== undefined &&
      values.baseUrl.trim() !== '' &&
      values.headers.every((row) => (row.name.trim() === '') === (row.value === ''))
    : values.secret.trim() !== '');

/** The form's fields and its save: the secret is sent once, then cleared from the page's memory. */
function usePasteForm(kind: PastedCredentialKind, onAdded: (subscription: Subscription) => void) {
  const api = useApi();
  const [values, setValues] = useState<PasteValues>(() => ({
    label: COPY[kind].name,
    secret: '',
    provider: undefined,
    baseUrl: '',
    headers: [{ id: 0, name: '', value: '' }],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof PasteValues>(key: K, value: PasteValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const added = await subscriptionCalls(api).add(bodyOf(kind, values));
      setValues((v) => ({ ...v, secret: '', headers: v.headers.map((row) => ({ ...row, value: '' })) }));
      onAdded(added);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  /** Chooses a gateway's provider (or none, to choose again), naming it after the provider unless renamed. */
  const choose = (provider: GatewayProvider | undefined) =>
    setValues((v) => ({
      ...v,
      provider,
      label: provider && STARTING_NAMES.includes(v.label) ? GATEWAY_STYLES[provider].name : v.label,
    }));
  return { values, set, choose, busy, error, ready: isReady(kind, values), save };
}

type PasteState = ReturnType<typeof usePasteForm>;

/** The secret of a paste (typed as dots), or a gateway's address and headers. */
function PastedSecret({ kind, form }: { readonly kind: PastedCredentialKind; readonly form: PasteState }) {
  const { provider } = form.values;
  if (kind === 'gateway' && provider !== undefined) {
    return (
      <>
        <GatewayAddress
          provider={provider}
          value={form.values.baseUrl}
          onChange={(baseUrl) => form.set('baseUrl', baseUrl)}
        />
        <HeaderRows rows={form.values.headers} onChange={(rows) => form.set('headers', rows)} />
      </>
    );
  }
  const copy = COPY[kind];
  return (
    <SecretField
      label={copy.secret}
      value={form.values.secret}
      onChange={(event) => form.set('secret', event.target.value)}
      required
      hint={copy.hint}
    />
  );
}

interface PasteFormProps {
  readonly kind: PastedCredentialKind;
  /** Saved: the new subscription, without its secret. */
  readonly onAdded: (subscription: Subscription) => void;
  readonly onBack: () => void;
}

/** The gateway form's first step: whose requests it takes, before anything else; Back closes the sheet. */
function GatewayStart({
  onChoose,
  onBack,
}: {
  readonly onChoose: (provider: GatewayProvider) => void;
  readonly onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <GatewayProviderChoice onChoose={onChoose} />
      <div className="flex justify-end">
        <Button onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

/**
 * Add a pasted subscription: its name and its secret (a setup-token or an API key, typed as dots), or a gateway: first
 * whose requests it takes (Claude Code's or Codex's), then its name, address and headers. The secret goes to the server
 * once and never comes back; a refusal shows here in plain words.
 */
export function PasteForm({ kind, onAdded, onBack }: PasteFormProps) {
  const form = usePasteForm(kind, onAdded);
  const { provider } = form.values;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.save();
  };
  if (kind === 'gateway' && provider === undefined)
    return <GatewayStart onBack={onBack} onChoose={form.choose} />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {provider !== undefined && (
        <GatewayProviderLine provider={provider} onChange={() => form.choose(undefined)} />
      )}
      <TextField
        label="Name"
        value={form.values.label}
        onChange={(event) => form.set('label', event.target.value)}
        required
        maxLength={CREDENTIAL_LABEL.max}
        hint="How it shows on your cards and in your access profiles."
      />
      <PastedSecret kind={kind} form={form} />
      {form.error && <Notice tone="error">{form.error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={form.busy} onClick={onBack}>
          Back
        </Button>
        <Button type="submit" tone="primary" busy={form.busy} disabled={!form.ready}>
          Save
        </Button>
      </div>
    </form>
  );
}
