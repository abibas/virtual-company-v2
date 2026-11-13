import { ATLASSIAN_TOKEN_PAGE, CREDENTIAL_LABEL, SLACK_APPS_PAGE } from '@mwc/shared/credentials';
import { ExternalLink } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { subscriptionCalls } from '../../api/subscriptions.ts';
import type { NewToolSignIn, Subscription } from '../../api/types.ts';
import { SecretField, TextField } from '../../components/forms/Field.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';

/** The pasted tool sign-ins: a GitHub token, an Atlassian site, email and API token, or a Slack token (S7.1e). */
export type PastedTool = 'github_token' | 'atlassian_api_token' | 'slack';

/** What a renewal starts from: the sign-in it replaces the secret of, and (Atlassian) its site and email. */
export interface Renewal {
  readonly credentialId: string;
  readonly site?: string | undefined;
  readonly email?: string | undefined;
}

interface Values {
  readonly label: string;
  readonly token: string;
  readonly site: string;
  readonly email: string;
}

/** What `POST /api/me/subscriptions/tools` takes for this form: no name when it is empty or a renewal. */
function bodyOf(kind: PastedTool, values: Values, renew: Renewal | undefined): NewToolSignIn {
  const label = values.label.trim();
  const named = renew ? { credentialId: renew.credentialId } : label === '' ? {} : { label };
  const token = values.token.trim();
  if (kind === 'github_token' || kind === 'slack') return { kind, token, ...named };
  return { kind, site: values.site.trim(), email: values.email.trim(), token, ...named };
}

const isReady = (kind: PastedTool, values: Values) =>
  values.token.trim() !== '' &&
  (kind !== 'atlassian_api_token' || (values.site.trim() !== '' && values.email.trim() !== ''));

/** Each form's words: the name's placeholder, the token's label and hint, and where to make one. */
const WORDS: Readonly<
  Record<PastedTool, { name: string; token: string; hint?: string; page?: readonly [string, string] }>
> = {
  github_token: {
    name: 'GitHub · your login',
    token: 'Token',
    hint: 'Classic (ghp_) or fine-grained (github_pat_).',
  },
  atlassian_api_token: {
    name: 'Atlassian · your site',
    token: 'API token',
    page: [ATLASSIAN_TOKEN_PAGE, 'Create an API token'],
  },
  slack: {
    name: 'Slack · your workspace',
    token: 'Token',
    hint: 'A bot token (xoxb-), or a user token (xoxp-), which posts as you.',
    page: [SLACK_APPS_PAGE, 'Your Slack apps'],
  },
};

interface ToolFormProps {
  readonly kind: PastedTool;
  /** Sign in again: the new secret replaces this sign-in's in place. */
  readonly renew?: Renewal | undefined;
  readonly onAdded: (signIn: Subscription) => void;
  readonly onBack: () => void;
}

type Change = (key: keyof Values) => (event: { target: { value: string } }) => void;

/** The form's values and its save: the token goes to the server once, then is cleared from the page. */
function useToolForm({ kind, renew, onAdded }: Omit<ToolFormProps, 'onBack'>) {
  const api = useApi();
  const [values, setValues] = useState<Values>({
    label: '',
    token: '',
    site: renew?.site ?? '',
    email: renew?.email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set: Change = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const added = await subscriptionCalls(api).addTool(bodyOf(kind, values, renew));
      setValues((current) => ({ ...current, token: '' }));
      onAdded(added);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { values, set, busy, error, submit };
}

/** Atlassian's site and the account's email. */
function AtlassianFields({ values, set }: { readonly values: Values; readonly set: Change }) {
  return (
    <>
      <TextField
        label="Site"
        value={values.site}
        onChange={set('site')}
        required
        autoComplete="off"
        spellCheck={false}
        placeholder="your-site.atlassian.net"
      />
      <TextField
        label="Email"
        type="email"
        value={values.email}
        onChange={set('email')}
        required
        autoComplete="email"
      />
    </>
  );
}

/**
 * Paste a GitHub token, add Atlassian, or paste a Slack token (a bot's or a user's, told by its prefix): the server
 * checks it with GitHub, Atlassian or Slack before it stores it, and a refusal shows here in plain words.
 */
export function ToolForm({ kind, renew, onAdded, onBack }: ToolFormProps) {
  const { values, set, busy, error, submit } = useToolForm({ kind, renew, onAdded });
  const words = WORDS[kind];
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!renew && (
        <TextField
          label="Name"
          value={values.label}
          onChange={set('label')}
          maxLength={CREDENTIAL_LABEL.max}
          placeholder={words.name}
        />
      )}
      {kind === 'atlassian_api_token' && <AtlassianFields values={values} set={set} />}
      <SecretField
        label={words.token}
        value={values.token}
        onChange={set('token')}
        required
        hint={words.hint}
      />
      {words.page && (
        <ButtonLink
          href={words.page[0]}
          newTab
          tone="quiet"
          size="sm"
          icon={ExternalLink}
          className="self-start"
        >
          {words.page[1]}
        </ButtonLink>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button type="submit" tone="primary" busy={busy} disabled={!isReady(kind, values)}>
          {renew ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
