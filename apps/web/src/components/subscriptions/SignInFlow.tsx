import { ExternalLink, RotateCcw } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { SignIn, SignInProvider } from '../../api/types.ts';
import { type Step, type StepState, Steps } from '../data/Steps.tsx';
import { CopyButton } from '../forms/CopyButton.tsx';
import { TextField } from '../forms/Field.tsx';
import { Button, ButtonLink } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { PROVIDER_NAMES } from './KindBadge.tsx';
import { isActive, type SignInControl, type SignInPhase } from './sign-in.ts';

type StepStates = readonly [start: StepState, approve: StepState, store: StepState];

/** Where each of the three steps stands in this phase. */
function statesOf(phase: SignInPhase): StepStates {
  if (phase.kind === 'requesting' || phase.kind === 'idle') return ['busy', 'todo', 'todo'];
  if (phase.kind === 'refused') return ['failed', 'todo', 'todo'];
  const { state, url } = phase.signIn;
  if (state === 'starting') return ['busy', 'todo', 'todo'];
  if (state === 'waiting_for_user' || state === 'waiting_for_code') return ['done', 'current', 'todo'];
  if (state === 'completing') return ['done', 'done', 'busy'];
  if (state === 'done') return ['done', 'done', 'done'];
  return url ? ['done', 'failed', 'todo'] : ['failed', 'todo', 'todo'];
}

/** Why it ended without a subscription, in plain words. */
function endedWhy(phase: SignInPhase): string | undefined {
  if (phase.kind === 'refused') return phase.message;
  if (phase.kind !== 'live') return undefined;
  const { state, message } = phase.signIn;
  if (state === 'expired') return message ?? 'The sign-in ran out of time (10 minutes). Nothing was stored.';
  if (state === 'cancelled') return message ?? 'The sign-in was cancelled. Nothing was stored.';
  if (state === 'failed') return message ?? 'The sign-in did not finish. Nothing was stored.';
  return undefined;
}

/** Claude's code, pasted back from Anthropic's page once it shows it; Continue sends it. */
function CodeForm({ control, ready }: { readonly control: SignInControl; readonly ready: boolean }) {
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    control.sendCode(code);
  };
  return (
    <form onSubmit={submit} className="mt-4 flex flex-col items-start gap-3">
      <TextField
        label="Paste the code from Anthropic’s page"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="The code Anthropic shows after you approve"
        error={control.code.error}
        hint={ready ? undefined : 'The sign-in asks for it in a moment.'}
        className="w-full"
      />
      <Button
        type="submit"
        tone="primary"
        busy={control.code.sending}
        disabled={!ready || code.trim() === ''}
      >
        Continue
      </Button>
    </form>
  );
}

/** OpenAI's one-time code, big, with a copy button: the person types it in on OpenAI's page. */
function DeviceCode({ code }: { readonly code: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
      <span className="font-mono text-2xl font-extrabold tracking-[0.14em] text-ink select-all">{code}</span>
      <CopyButton text={code} label="Copy code" />
    </div>
  );
}

/** The person's step: the provider's page in a new tab, and Claude's code to paste or OpenAI's code to type in. */
function ApproveDetail({ signIn, control }: { readonly signIn: SignIn; readonly control: SignInControl }) {
  const name = PROVIDER_NAMES[signIn.provider];
  return (
    <div>
      {signIn.url && (
        <ButtonLink href={signIn.url} newTab tone="primary" icon={ExternalLink}>
          Open {name} sign-in
        </ButtonLink>
      )}
      {signIn.provider === 'openai' && signIn.userCode && <DeviceCode code={signIn.userCode} />}
      {signIn.provider === 'openai' && (
        <p className="mt-3 text-xs text-dim">
          The app notices when you are done. If OpenAI says device code sign-in is off, turn it on in
          ChatGPT’s security settings and start again.
        </p>
      )}
      {signIn.provider === 'claude' && (
        <CodeForm control={control} ready={signIn.state === 'waiting_for_code'} />
      )}
    </div>
  );
}

/** The three steps, with what the person does at the current one. */
function stepsFor(provider: SignInProvider, phase: SignInPhase, control: SignInControl): readonly Step[] {
  const [start, approve, store] = statesOf(phase);
  const name = PROVIDER_NAMES[provider];
  const signIn = phase.kind === 'live' ? phase.signIn : undefined;
  const approveDetail: ReactNode =
    approve === 'current' && signIn ? <ApproveDetail signIn={signIn} control={control} /> : undefined;
  return [
    {
      key: 'start',
      label: 'Start a private sign-in',
      state: start,
      detail: start === 'busy' && (
        <p className="text-xs text-dim">
          The official CLI runs in a throwaway sandbox. The first sign-in prepares it, a minute or two.
        </p>
      ),
    },
    {
      key: 'approve',
      label:
        provider === 'claude'
          ? `Approve on ${name}’s page, then paste the code it shows`
          : `Sign in on ${name}’s page and enter the one-time code`,
      state: approve,
      detail: approveDetail,
    },
    { key: 'store', label: 'Store your login, encrypted', state: store },
  ];
}

/** "Signed in as …", or "Signed in again as …" for a renewed subscription, with a note when its account changed. */
function DoneNotice({
  live,
  again,
}: {
  readonly live: Extract<SignInPhase, { kind: 'live' }>;
  readonly again: boolean;
}) {
  if (!again) {
    return (
      <Notice tone="success" title="Signed in">
        {live.email ? `Signed in as ${live.email}.` : 'Your subscription is stored.'} Rename it or put it in
        an access profile on the Subscriptions page.
      </Notice>
    );
  }
  return (
    <Notice tone="success" title="Signed in again">
      {live.email ? `Signed in again as ${live.email}.` : 'Your subscription is renewed.'} It keeps its name
      and its access profiles.
      {live.signIn.accountChanged &&
        ' This is a different account than before: the subscription and the agents using it now run on it.'}
    </Notice>
  );
}

interface SignInFlowProps {
  readonly provider: SignInProvider;
  /** Sign in again on this subscription: the login renews it in place. */
  readonly credentialId?: string | undefined;
  readonly control: SignInControl;
  /** Back to the choices (cancelling a sign-in in progress). */
  readonly onBack: () => void;
  /** Close the sheet after a sign-in that worked. */
  readonly onDone: () => void;
}

/**
 * Sign in with Claude or OpenAI, as it happens: the steps filling in, the provider's page to open, the code, then
 * "Signed in as …", or why it ended with Try again. Cancel ends the sign-in on the server.
 */
export function SignInFlow({ provider, credentialId, control, onBack, onDone }: SignInFlowProps) {
  const { phase } = control;
  const live = phase.kind === 'live' ? phase : undefined;
  const running = phase.kind === 'requesting' || (live !== undefined && isActive(live.signIn));
  const why = endedWhy(phase);
  return (
    <div className="flex flex-col gap-5">
      <Steps label={`Sign in with ${PROVIDER_NAMES[provider]}`} steps={stepsFor(provider, phase, control)} />
      {live?.signIn.state === 'done' && <DoneNotice live={live} again={credentialId !== undefined} />}
      {why && <Notice tone="error">{why}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        {running && <Button onClick={onBack}>Cancel</Button>}
        {why && <Button onClick={onBack}>Back</Button>}
        {why && (
          <Button tone="primary" icon={RotateCcw} onClick={() => control.start(provider, credentialId)}>
            Try again
          </Button>
        )}
        {live?.signIn.state === 'done' && (
          <Button tone="primary" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
