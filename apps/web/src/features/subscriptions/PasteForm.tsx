import {
  CREDENTIAL_LABEL,
  GATEWAY_HEADERS,
  type PastedCredentialKind,
  SECRET_PREFIXES,
} from '@mwc/shared/credentials';
import { Plus, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { subscriptionCalls } from '../../api/subscriptions.ts';
import type { NewSubscription, Subscription } from '../../api/types.ts';
import { SECRET_INPUT, SecretField, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { Notice } from '../../components/ui/Notice.tsx';

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
    hint: 'The address runs send their AI requests to, and the headers it needs with each one.',
  },
};

/** The sheet's title for a paste form. */
export const pasteTitle = (kind: PastedCredentialKind): string => COPY[kind].title;

interface HeaderRow {
  readonly id: number;
  readonly name: string;
  readonly value: string;
}

/** What the form holds: a name, and a secret or a gateway's address and headers. */
interface PasteValues {
  readonly label: string;
  readonly secret: string;
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
  if (kind === 'gateway') return { kind, label, baseUrl: values.baseUrl.trim(), headers };
  return { kind, label, apiKey: secret };
}

/** True when the form has all the API needs. */
const isReady = (kind: PastedCredentialKind, values: PasteValues): boolean =>
  values.label.trim() !== '' &&
  (kind === 'gateway'
    ? values.baseUrl.trim() !== '' &&
      values.headers.every((row) => (row.name.trim() === '') === (row.value === ''))
    : values.secret.trim() !== '');

/** The form's fields and its save: the secret is sent once, then cleared from the page's memory. */
function usePasteForm(kind: PastedCredentialKind, onAdded: (subscription: Subscription) => void) {
  const api = useApi();
  const [values, setValues] = useState<PasteValues>(() => ({
    label: COPY[kind].name,
    secret: '',
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
  return { values, set, busy, error, ready: isReady(kind, values), save };
}

/** A gateway's headers: name and value rows (values as secrets), none to 20; an empty row is left out. */
function HeaderRows({
  rows,
  onChange,
}: {
  readonly rows: readonly HeaderRow[];
  readonly onChange: (rows: readonly HeaderRow[]) => void;
}) {
  const nextId = useRef(rows.length);
  const set = (id: number, change: Partial<HeaderRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const add = () => onChange([...rows, { id: nextId.current++, name: '', value: '' }]);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-ink-2">Headers (optional)</legend>
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            aria-label={`Header ${index + 1} name`}
            value={row.name}
            placeholder="x-api-key"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => set(row.id, { name: event.target.value })}
          />
          <Input
            aria-label={`Header ${index + 1} value`}
            value={row.value}
            placeholder="Value"
            {...SECRET_INPUT}
            onChange={(event) => set(row.id, { value: event.target.value })}
          />
          <IconButton
            label={`Remove header ${index + 1}`}
            icon={X}
            size="sm"
            onClick={() => onChange(rows.filter((other) => other.id !== row.id))}
          />
        </div>
      ))}
      {rows.length < GATEWAY_HEADERS.max && (
        <Button size="sm" tone="quiet" icon={Plus} onClick={add} className="-ml-2 self-start">
          Add a header
        </Button>
      )}
      <p className="text-xs text-dim">The values are stored encrypted and never shown again.</p>
    </fieldset>
  );
}

interface PasteFormProps {
  readonly kind: PastedCredentialKind;
  /** Saved: the new subscription, without its secret. */
  readonly onAdded: (subscription: Subscription) => void;
  readonly onBack: () => void;
}

/**
 * Add a pasted subscription: its name and its secret (a setup-token or an API key, typed as dots), or a gateway's
 * address and headers. The secret goes to the server once and never comes back; a refusal shows here in plain words.
 */
export function PasteForm({ kind, onAdded, onBack }: PasteFormProps) {
  const form = usePasteForm(kind, onAdded);
  const copy = COPY[kind];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.save();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label="Name"
        value={form.values.label}
        onChange={(event) => form.set('label', event.target.value)}
        required
        maxLength={CREDENTIAL_LABEL.max}
        hint="How it shows on your cards and in your access profiles."
      />
      {kind === 'gateway' ? (
        <>
          <TextField
            label="Address"
            type="url"
            inputMode="url"
            value={form.values.baseUrl}
            onChange={(event) => form.set('baseUrl', event.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="http://localhost:8300"
            hint={copy.hint}
          />
          <HeaderRows rows={form.values.headers} onChange={(rows) => form.set('headers', rows)} />
        </>
      ) : (
        <SecretField
          label={copy.secret}
          value={form.values.secret}
          onChange={(event) => form.set('secret', event.target.value)}
          required
          hint={copy.hint}
        />
      )}
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
