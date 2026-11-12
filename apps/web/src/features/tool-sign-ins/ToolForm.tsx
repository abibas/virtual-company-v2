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

/**
 * Paste a GitHub token, or add Atlassian: the server checks it with GitHub or Atlassian before it stores it, and a
 * refusal shows here in plain words. The token goes to the server once and is cleared from the page.
 */
export function ToolForm({ kind, renew, onAdded, onBack }: ToolFormProps) {
  const api = useApi();
  const [values, setValues] = useState<Values>({
    label: '',
    token: '',
    site: renew?.site ?? '',
    email: renew?.email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof Values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
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
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!renew && (
        <TextField
          label="Name"
          value={values.label}
          onChange={set('label')}
          maxLength={CREDENTIAL_LABEL.max}
          placeholder={kind === 'github_token' ? 'GitHub · your login' : 'Atlassian · your site'}
        />
      )}
      {kind === 'atlassian_api_token' && (
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
      )}
      <SecretField
        label={kind === 'github_token' ? 'Token' : 'API token'}
        value={values.token}
        onChange={set('token')}
        required
        hint={kind === 'github_token' ? 'Classic (ghp_) or fine-grained (github_pat_).' : undefined}
      />
      {kind === 'atlassian_api_token' && (
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
