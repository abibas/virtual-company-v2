import { ATLASSIAN_TOKEN_PAGE, CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { ExternalLink } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { subscriptionCalls } from '../../api/subscriptions.ts';
import type { NewToolSignIn, Subscription } from '../../api/types.ts';
import { SecretField, TextField } from '../../components/forms/Field.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';

/** The pasted tool sign-ins: a GitHub token, or an Atlassian site, email and API token. */
export type PastedTool = 'github_token' | 'atlassian_api_token';

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
  if (kind === 'github_token') return { kind, token, ...named };
  return { kind, site: values.site.trim(), email: values.email.trim(), token, ...named };
}

const isReady = (kind: PastedTool, values: Values) =>
  values.token.trim() !== '' &&
  (kind === 'github_token' || (values.site.trim() !== '' && values.email.trim() !== ''));

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
 * Paste a GitHub token, or add Atlassian: the server checks it with GitHub or Atlassian before it stores it, and a
 * refusal shows here in plain words.
 */
export function ToolForm({ kind, renew, onAdded, onBack }: ToolFormProps) {
  const { values, set, busy, error, submit } = useToolForm({ kind, renew, onAdded });
  const github = kind === 'github_token';
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!renew && (
        <TextField
          label="Name"
          value={values.label}
          onChange={set('label')}
          maxLength={CREDENTIAL_LABEL.max}
          placeholder={github ? 'GitHub · your login' : 'Atlassian · your site'}
        />
      )}
      {!github && <AtlassianFields values={values} set={set} />}
      <SecretField
        label={github ? 'Token' : 'API token'}
        value={values.token}
        onChange={set('token')}
        required
        hint={github ? 'Classic (ghp_) or fine-grained (github_pat_).' : undefined}
      />
      {!github && (
        <ButtonLink
          href={ATLASSIAN_TOKEN_PAGE}
          newTab
          tone="quiet"
          size="sm"
          icon={ExternalLink}
          className="self-start"
        >
          Create an API token
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
