import { POSITION_TITLE_MAX } from '@mwc/shared/org';
import { type ReactNode, useId, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { OrgCalls } from '../../api/org.ts';
import type { ChartNode, OrgChart, PositionChange } from '../../api/types.ts';
import { Input } from '../../components/forms/Input.tsx';
import { nodeName, TOP } from '../../components/org/chart.ts';
import { PrincipalSelect } from '../../components/org/PrincipalSelect.tsx';
import { Button } from '../../components/ui/Button.tsx';

interface EditorProps {
  readonly node: ChartNode;
  readonly calls: OrgCalls;
  /** Saved: close the editor and read the chart again. */
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}

/** `PUT .../org/positions/:principalId` from a card, with its progress and its refusal in plain words. */
function usePlace({ node, calls, onSaved }: EditorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (change: PositionChange) => {
    setBusy(true);
    setError(undefined);
    try {
      await calls.place(node.principalId, change);
      onSaved();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

/** A small form inside a card: its label and control, the refusal, Cancel and Save. Escape cancels. */
function EditFrame({
  id,
  label,
  busy,
  error,
  canSave,
  onSubmit,
  onCancel,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly canSave: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <label htmlFor={id} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" tone="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" type="submit" busy={busy} disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Edit Title: the title on the chart (empty clears it); admins title anyone, everyone titles themselves. */
export function TitleEditor(props: EditorProps) {
  const id = useId();
  const saved = props.node.title ?? '';
  const [title, setTitle] = useState(saved);
  const { busy, error, save } = usePlace(props);
  const next = title.trim();
  return (
    <EditFrame
      id={id}
      label="Title on the chart"
      busy={busy}
      error={error}
      canSave={next !== saved}
      onSubmit={() => void save({ title: next || null })}
      onCancel={props.onCancel}
    >
      <Input
        id={id}
        size="sm"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={POSITION_TITLE_MAX}
        placeholder="CTO, Platform PM…"
        autoFocus
      />
    </EditFrame>
  );
}

/** Reports to…: the manager among the chart's other places (admins); a refusal of the org rules shows here. */
export function ManagerEditor({
  chart,
  meUserId,
  ...props
}: EditorProps & { readonly chart: OrgChart; readonly meUserId: string }) {
  const id = useId();
  const saved = props.node.reportsTo ?? TOP;
  const [manager, setManager] = useState(saved);
  const { busy, error, save } = usePlace(props);
  return (
    <EditFrame
      id={id}
      label={`${nodeName(props.node)} reports to`}
      busy={busy}
      error={error}
      canSave={manager !== saved}
      onSubmit={() => void save({ reportsToPrincipalId: manager === TOP ? null : manager })}
      onCancel={props.onCancel}
    >
      <PrincipalSelect
        id={id}
        size="sm"
        nodes={chart.nodes}
        tree={chart.tree}
        subject={{ principalId: props.node.principalId, kind: props.node.kind }}
        value={manager}
        onChange={setManager}
        meUserId={meUserId}
        autoFocus
      />
    </EditFrame>
  );
}
