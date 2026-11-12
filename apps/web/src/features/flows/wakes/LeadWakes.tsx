import { BellRing, MessagesSquare } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { LeadWakeSettings, LeadWakes } from '../../../api/flows.ts';
import { Link } from '../../../app/router.tsx';
import { Input } from '../../../components/forms/Input.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { BOUNDS, lastWords, settingsOf, WAKE_EVENTS, within } from './words.ts';

/**
 * The Flow tab's "Lead wakes up on" section (S6c), for those who lead the team when the Lead is an agent: the events
 * that wake it in its team chat, a sign-off's waiting hours, the quiet window and the caps per hour and per day, Save;
 * and one line saying how the last wake-up went, with the team chat. Data and the save come as props.
 */

type Change = (change: Partial<LeadWakeSettings>) => void;

/** A small number box inside a sentence. */
function NumberBox({
  label,
  value,
  range,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <span className="w-16 shrink-0">
      <Input
        aria-label={label}
        type="number"
        size="sm"
        min={range.min}
        max={range.max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(within(event.target.value, range))}
      />
    </span>
  );
}

const Sentence = ({ children }: { readonly children: ReactNode }) => (
  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">{children}</span>
);

/** The sign-off's wait: a switch, and its hours while on. */
function SignoffWait({
  draft,
  disabled,
  change,
}: {
  draft: LeadWakeSettings;
  disabled: boolean;
  change: Change;
}) {
  const on = draft.signoffHours !== null;
  return (
    <Sentence>
      <Switch
        label="A sign-off waits over"
        checked={on}
        disabled={disabled}
        onChange={(next) => change({ signoffHours: next ? 24 : null })}
      />
      {on && (
        <>
          <NumberBox
            label="Hours a sign-off waits"
            value={draft.signoffHours ?? 24}
            range={BOUNDS.signoffHours}
            disabled={disabled}
            onChange={(signoffHours) => change({ signoffHours })}
          />
          hours
        </>
      )}
    </Sentence>
  );
}

/** The window and the caps, as two sentences. */
function Limits({ draft, disabled, change }: { draft: LeadWakeSettings; disabled: boolean; change: Change }) {
  return (
    <div className="flex flex-col gap-2">
      <Sentence>
        Events within
        <NumberBox
          label="Seconds that make one wake-up"
          value={draft.windowSeconds}
          range={BOUNDS.windowSeconds}
          disabled={disabled}
          onChange={(windowSeconds) => change({ windowSeconds })}
        />
        seconds go as one message
      </Sentence>
      <Sentence>
        At most
        <NumberBox
          label="Wake-ups an hour"
          value={draft.maxPerHour}
          range={BOUNDS.perHour}
          disabled={disabled}
          onChange={(maxPerHour) => change({ maxPerHour })}
        />
        an hour and
        <NumberBox
          label="Wake-ups a day"
          value={draft.maxPerDay}
          range={BOUNDS.perDay}
          disabled={disabled}
          onChange={(maxPerDay) => change({ maxPerDay })}
        />
        a day; past that, you are told instead
      </Sentence>
    </div>
  );
}

/** Saves the draft: busy while it goes, the refusal in plain words. */
function useSave(onSave: (settings: LeadWakeSettings) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = (settings: LeadWakeSettings) => {
    setBusy(true);
    setError(undefined);
    onSave(settings)
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return { busy, error, save };
}

export function LeadWakesSection({
  wakes,
  leadName,
  chatHref,
  onSave,
}: {
  readonly wakes: LeadWakes;
  readonly leadName: string;
  /** The team chat's page, once the Lead was woken there. */
  readonly chatHref: string | undefined;
  readonly onSave: (settings: LeadWakeSettings) => Promise<void>;
}) {
  const saved = settingsOf(wakes);
  const [draft, setDraft] = useState(saved);
  const { busy, error, save } = useSave(onSave);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const change: Change = (next) => setDraft({ ...draft, ...next });
  return (
    <Card padding="sm" as="section" aria-label="Lead wakes up on" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <BellRing size={16} aria-hidden="true" className="text-blue" />
        <h2 className="text-sm font-bold text-ink">Lead wakes up on</h2>
        <span className="text-xs text-dim">{leadName} gets a short message in its team chat</span>
        {chatHref && (
          <Link
            to={chatHref}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-blue"
          >
            <MessagesSquare size={13} aria-hidden="true" />
            Team chat
          </Link>
        )}
      </header>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {WAKE_EVENTS.map((event) => (
          <Switch
            key={event.key}
            label={event.label}
            checked={draft[event.key]}
            disabled={busy}
            onChange={(on) => change({ [event.key]: on })}
          />
        ))}
      </div>
      <SignoffWait draft={draft} disabled={busy} change={change} />
      <Limits draft={draft} disabled={busy} change={change} />
      <p className="text-xs text-dim">{lastWords(wakes)}</p>
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" tone="primary" busy={busy} onClick={() => save(draft)}>
            Save
          </Button>
          <Button size="sm" tone="quiet" disabled={busy} onClick={() => setDraft(saved)}>
            Discard
          </Button>
        </div>
      )}
    </Card>
  );
}
