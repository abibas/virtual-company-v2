import { isSlackAppToken, SLACK_INBOUND_PER_HOUR } from '@mwc/shared/credentials';
import { useMemo, useState } from 'react';
import { useApi } from '../../../api/context.ts';
import { friendlyMessage } from '../../../api/errors.ts';
import {
  type SlackInbound,
  type SlackInboundChange,
  slackInboundCalls,
  useSlackInbound,
} from '../../../api/slack-inbound.ts';
import { cx } from '../../../components/cx.ts';
import { SECRET_INPUT, SelectField } from '../../../components/forms/Field.tsx';
import { Input } from '../../../components/forms/Input.tsx';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { SlackPeoplePicker } from './SlackPeoplePicker.tsx';

/** The connection's status as a toned word, and what happened in words when Slack said. */
const STATUS: Readonly<
  Record<SlackInbound['status'], readonly ['done' | 'input' | 'blocked' | 'neutral', string]>
> = {
  off: ['neutral', 'Off'],
  connecting: ['input', 'Connecting'],
  connected: ['done', 'Connected'],
  disconnected: ['input', 'Disconnected'],
  error: ['blocked', 'Error'],
};

/** Saves a change and shows the settings as saved; its refusal in words. */
function useSave(credentialId: string, reload: () => void) {
  const api = useApi();
  const calls = useMemo(() => slackInboundCalls(api), [api]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = (change: SlackInboundChange) => {
    setBusy(true);
    setError(undefined);
    return calls
      .save(credentialId, change)
      .then(reload, (failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return { save, error, busy };
}

/** The app-level token: set (Replace, Remove) or a field to paste it. */
function AppToken({
  set,
  save,
  busy,
}: {
  readonly set: boolean;
  readonly save: (token: string | null) => void;
  readonly busy: boolean;
}) {
  const [editing, setEditing] = useState(!set);
  const [token, setToken] = useState('');
  if (set && !editing)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">App-level token set</span>
        <Button size="sm" tone="quiet" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button size="sm" tone="quiet" disabled={busy} onClick={() => save(null)}>
          Remove
        </Button>
      </div>
    );
  const valid = isSlackAppToken(token);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        save(token.trim());
        setToken('');
        setEditing(false);
      }}
    >
      <Input
        {...SECRET_INPUT}
        size="sm"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="xapp-…"
        aria-label="App-level token"
      />
      <Button size="sm" tone="primary" type="submit" disabled={!valid || busy}>
        Save
      </Button>
      {set && (
        <Button size="sm" tone="quiet" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      )}
    </form>
  );
}

/** The hourly cap, saved when it loses focus or on Enter. */
function Cap({
  value,
  lastHour,
  save,
}: {
  readonly value: number;
  readonly lastHour: number;
  readonly save: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (
      Number.isInteger(n) &&
      n >= SLACK_INBOUND_PER_HOUR.min &&
      n <= SLACK_INBOUND_PER_HOUR.max &&
      n !== value
    )
      save(n);
    else setText(String(value));
  };
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      At most
      <Input
        size="sm"
        type="number"
        aria-label="Answers an hour at most"
        min={SLACK_INBOUND_PER_HOUR.min}
        max={SLACK_INBOUND_PER_HOUR.max}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        className="w-20"
      />
      answers an hour
      <span className="text-xs text-dim">· {lastHour} in the last hour</span>
    </div>
  );
}

type SaveChange = (change: SlackInboundChange) => void;

/** Who can wake agents: anyone in the allowed channels, or only the people chosen. */
function WakeChoice({ inbound, save }: { readonly inbound: SlackInbound; readonly save: SaveChange }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-dim">Who can wake agents</span>
      <SegmentedControl
        size="sm"
        label="Who can wake agents"
        value={inbound.wake}
        onChange={(wake) => save({ wake })}
        options={[
          { value: 'anyone', label: 'Anyone in the allowed channels' },
          { value: 'listed', label: 'Only these people' },
        ]}
      />
      {inbound.wake === 'listed' && (
        <SlackPeoplePicker
          credentialId={inbound.credentialId}
          people={inbound.people}
          onChange={(people) => save({ people })}
        />
      )}
    </div>
  );
}

/** The default agent, among the agents whose profile's Slack part uses this sign-in (with their company if several). */
function DefaultAgent({ inbound, save }: { readonly inbound: SlackInbound; readonly save: SaveChange }) {
  const several = new Set(inbound.agents.map((agent) => agent.companyId)).size > 1;
  const choices = inbound.agents.map((agent) => ({
    value: `${agent.companyId}/${agent.agentId}`,
    label: several ? `${agent.agentName} · ${agent.companyName}` : agent.agentName,
  }));
  const { defaultAgent } = inbound;
  return (
    <SelectField
      label="Default agent"
      size="sm"
      value={defaultAgent ? `${defaultAgent.companyId}/${defaultAgent.agentId}` : ''}
      onChange={(event) => {
        const [companyId, agentId] = event.target.value.split('/');
        save({ defaultAgent: companyId && agentId ? { companyId, agentId } : null });
      }}
      options={[
        { value: '', label: choices.length === 0 ? 'No agent uses this sign-in' : 'None' },
        ...choices,
      ]}
    />
  );
}

/** The settings once the token is set: who may wake agents, the default agent, the cap. */
function Settings({ inbound, save }: { readonly inbound: SlackInbound; readonly save: SaveChange }) {
  return (
    <>
      <WakeChoice inbound={inbound} save={save} />
      <DefaultAgent inbound={inbound} save={save} />
      <Cap
        key={inbound.maxPerHour}
        value={inbound.maxPerHour}
        lastHour={inbound.lastHour}
        save={(maxPerHour) => save({ maxPerHour })}
      />
    </>
  );
}

/**
 * A Slack bot sign-in's "Receive messages" (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): the switch
 * and the connection's status, the app-level token, who can wake agents (anyone in the allowed channels, or only the
 * people chosen), the default agent and the hourly cap, each saved as it changes.
 */
export function SlackReceive({ credentialId }: { readonly credentialId: string }) {
  const loaded = useSlackInbound(credentialId);
  const { save, error, busy } = useSave(credentialId, loaded.reload);
  const inbound = loaded.data;
  if (inbound === undefined)
    return loaded.error ? <p className="text-xs text-blocked">{friendlyMessage(loaded.error)}</p> : null;
  const [tone, word] = STATUS[inbound.status];
  return (
    <section aria-label="Receive messages" className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch
            label="Receive messages"
            checked={inbound.inbound}
            disabled={busy || !inbound.appToken}
            onChange={(on) => void save({ inbound: on })}
          />
          {inbound.inbound && (
            <Badge tone={tone} dot size="sm">
              {word}
            </Badge>
          )}
        </div>
      </div>
      {inbound.statusMessage && inbound.inbound && (
        <p className={cx('text-xs', inbound.status === 'error' ? 'text-blocked' : 'text-dim')}>
          {inbound.statusMessage}
        </p>
      )}
      {inbound.inbound && !inbound.receiving && (
        <p className="text-xs text-dim">
          This server runs no background work, so it keeps no Slack connection.
        </p>
      )}
      <AppToken set={inbound.appToken} busy={busy} save={(appToken) => void save({ appToken })} />
      {inbound.appToken && <Settings inbound={inbound} save={(change) => void save(change)} />}
      {error && <p className="text-xs text-blocked">{error}</p>}
    </section>
  );
}
