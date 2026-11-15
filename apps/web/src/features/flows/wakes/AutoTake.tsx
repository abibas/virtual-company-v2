import { IN_PROGRESS_LIMIT } from '@mwc/shared/flows';
import { ListStart } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Flow, FlowCalls } from '../../../api/flows.ts';
import { Input, Select } from '../../../components/forms/Input.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { within } from './words.ts';

/** What the card edits: where new tasks go and how (T-38), auto-take on or off, and the most tasks in progress. */
interface QueueDraft {
  /** null: Queued. */
  readonly newTaskStepId: string | null;
  readonly newTaskAutoTake: boolean;
  readonly autoTake: boolean;
  readonly inProgressLimit: number;
}

/** A step the new tasks can go to. */
type QueueStep = Pick<Flow['steps'][number], 'id' | 'position' | 'name' | 'starts'>;

/** The select's value for Queued. */
const QUEUED = '';

const FIELDS = ['newTaskStepId', 'newTaskAutoTake', 'autoTake', 'inProgressLimit'] as const;

/** The card's one line: what happens to a new task with these settings. */
function queueLine(draft: QueueDraft, steps: readonly QueueStep[]): string {
  const taking = draft.autoTake
    ? `the flow's Autotake takes only those marked Autotake into the first step, at most ${draft.inProgressLimit} in progress`
    : "the flow's Autotake is off: someone starts each one";
  const step = steps.find((s) => s.id === draft.newTaskStepId);
  if (step === undefined)
    return `New tasks wait in Queued as ${draft.newTaskAutoTake ? 'Autotake' : 'Manual'}; ${taking}.`;
  const starts = step.starts === 'auto' ? ', which starts them at once' : '';
  return `New tasks skip Queued and go straight to "${step.name}"${starts}; for tasks put in Queued, ${taking}.`;
}

/** A label and its control on one row of the card. */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-ink-2">
      <span className="w-32 shrink-0">{label}</span>
      <span className="w-48 max-w-full">{children}</span>
    </label>
  );
}

/**
 * The Flow tab's "Queue" card, for those who lead the team: where a new task goes when its creator does not say
 * (Queued or a step) and, in Queued, whether it is Autotake or Manual (T-38; greyed out when new tasks skip Queued),
 * then the flow's Autotake switch and the most tasks in progress (active at any step) before it waits (T-25); one line
 * says what that adds up to. Save and Discard while changed.
 */
export function QueueSection({
  saved,
  steps,
  onSave,
}: {
  readonly saved: QueueDraft;
  readonly steps: readonly QueueStep[];
  readonly onSave: (draft: QueueDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = FIELDS.some((field) => draft[field] !== saved[field]);
  const save = () => {
    setBusy(true);
    setError(undefined);
    onSave(draft)
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  const skipsQueued = draft.newTaskStepId !== null;
  return (
    <Card padding="sm" as="section" aria-label="Queue" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <ListStart size={16} aria-hidden="true" className="text-blue" />
        <h2 className="text-sm font-bold text-ink">Queue</h2>
        <span className="text-xs text-dim">{queueLine(draft, steps)}</span>
      </header>
      <Row label="New tasks go to">
        <Select
          size="sm"
          value={draft.newTaskStepId ?? QUEUED}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, newTaskStepId: event.target.value === QUEUED ? null : event.target.value })
          }
          options={[
            { value: QUEUED, label: 'Queued' },
            ...steps.map((s) => ({ value: s.id, label: `${s.position}. ${s.name}` })),
          ]}
        />
      </Row>
      <Row label="New tasks are">
        <Select
          size="sm"
          value={draft.newTaskAutoTake ? 'auto' : 'manual'}
          disabled={busy || skipsQueued}
          title={skipsQueued ? 'New tasks skip Queued, so Autotake does not apply to them' : undefined}
          className={skipsQueued ? 'opacity-50' : undefined}
          onChange={(event) => setDraft({ ...draft, newTaskAutoTake: event.target.value === 'auto' })}
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'auto', label: 'Autotake' },
          ]}
        />
      </Row>
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
        <Switch
          label="Autotake"
          checked={draft.autoTake}
          disabled={busy}
          onChange={(autoTake) => setDraft({ ...draft, autoTake })}
        />
        · at most
        <span className="w-16 shrink-0">
          <Input
            aria-label="Tasks in progress at most"
            type="number"
            size="sm"
            min={IN_PROGRESS_LIMIT.min}
            max={IN_PROGRESS_LIMIT.max}
            value={draft.inProgressLimit}
            disabled={busy}
            onChange={(event) =>
              setDraft({ ...draft, inProgressLimit: within(event.target.value, IN_PROGRESS_LIMIT) })
            }
          />
        </span>
        in progress
      </span>
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" tone="primary" busy={busy} onClick={save}>
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

/** The card, live: the flow's settings, saved with a PATCH on the flow, then the flow and its board read again. */
export function LiveQueue({
  flow,
  calls,
  onSaved,
}: {
  readonly flow: Flow;
  readonly calls: FlowCalls;
  readonly onSaved: () => void;
}) {
  const saved: QueueDraft = {
    newTaskStepId: flow.newTaskStepId,
    newTaskAutoTake: flow.newTaskAutoTake,
    autoTake: flow.autoTake,
    inProgressLimit: flow.inProgressLimit,
  };
  return (
    <QueueSection
      key={FIELDS.map((field) => String(saved[field])).join(':')}
      saved={saved}
      steps={flow.steps}
      onSave={async (draft) => {
        await calls.patchFlow(flow.id, draft);
        onSaved();
      }}
    />
  );
}
