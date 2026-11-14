import { IN_PROGRESS_LIMIT } from '@mwc/shared/flows';
import { ListStart } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Flow, FlowCalls } from '../../../api/flows.ts';
import { Input } from '../../../components/forms/Input.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { within } from './words.ts';

/** What the row edits: auto-take on or off, and the most tasks in progress. */
interface AutoTakeDraft {
  readonly autoTake: boolean;
  readonly inProgressLimit: number;
}

/**
 * The Flow tab's "Autotake" card (T-25), for those who lead the team: a switch and the most tasks in
 * progress (active at any step) before the flow waits; Save and Discard while changed.
 */
export function AutoTakeSection({
  saved,
  onSave,
}: {
  readonly saved: AutoTakeDraft;
  readonly onSave: (draft: AutoTakeDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = draft.autoTake !== saved.autoTake || draft.inProgressLimit !== saved.inProgressLimit;
  const save = () => {
    setBusy(true);
    setError(undefined);
    onSave(draft)
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <Card padding="sm" as="section" aria-label="Autotake" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <ListStart size={16} aria-hidden="true" className="text-blue" />
        <h2 className="text-sm font-bold text-ink">Autotake</h2>
        <span className="text-xs text-dim">
          The next queued task (by priority, then the oldest) enters the first step by itself
        </span>
      </header>
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

/** The row, live: the flow's settings, saved with a PATCH on the flow, then the flow and its board read again. */
export function LiveAutoTake({
  flow,
  calls,
  onSaved,
}: {
  readonly flow: Flow;
  readonly calls: FlowCalls;
  readonly onSaved: () => void;
}) {
  const saved = { autoTake: flow.autoTake, inProgressLimit: flow.inProgressLimit };
  return (
    <AutoTakeSection
      key={`${saved.autoTake}:${saved.inProgressLimit}`}
      saved={saved}
      onSave={async (draft) => {
        await calls.patchFlow(flow.id, draft);
        onSaved();
      }}
    />
  );
}
