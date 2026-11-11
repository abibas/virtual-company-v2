import { FLOW_NAME, FLOW_STEPS_MAX } from '@mwc/shared/flows';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Flow, FlowCalls } from '../../../api/flows.ts';
import type { ChartNode, OrgChart } from '../../../api/types.ts';
import { Input, type SelectOption } from '../../../components/forms/Input.tsx';
import { nodeName, nodesById } from '../../../components/org/chart.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { FlowDrawing } from '../drawing/FlowDrawing.tsx';
import {
  changeStep,
  type DraftStep,
  draftOf,
  draftReady,
  drawnDraft,
  moveStep,
  newStep,
  problemOf,
  removeStep,
  toInput,
} from './draft.ts';
import { StepRow } from './StepRow.tsx';
import { useStepDrag } from './use-step-drag.ts';

/** What the editor edits: a flow's steps, or a new flow for a Lead who has none. */
export type EditorSubject =
  | { readonly kind: 'edit'; readonly flow: Flow }
  | { readonly kind: 'create'; readonly lead: ChartNode };

/** The company's people, then its agents, as the assignee's choices ("(you)" on the signed-in person). */
function assigneeOptions(nodes: readonly ChartNode[], meUserId: string): SelectOption[] {
  return (['person', 'agent'] as const).flatMap((kind) =>
    nodes
      .filter((node) => node.kind === kind)
      .map((node) => ({
        value: node.principalId,
        label: `${nodeName(node)}${node.kind === 'person' && node.person.userId === meUserId ? ' (you)' : ''}`,
        group: kind === 'person' ? 'People' : 'Agents',
      })),
  );
}

/** Who a new step goes to: the Lead's first report, else the Lead. */
function firstReport(chart: OrgChart, lead: string): string {
  return chart.nodes.find((node) => node.reportsTo === lead)?.principalId ?? lead;
}

/** The draft and the save: `PUT …/steps` then a rename for a flow, `POST …/flows` for a new one. */
function useEditor(subject: EditorSubject, chart: OrgChart, calls: FlowCalls, onSaved: (flow: Flow) => void) {
  const lead = subject.kind === 'edit' ? subject.flow.lead.principalId : subject.lead.principalId;
  const [name, setName] = useState(
    subject.kind === 'edit' ? subject.flow.name : `${nodeName(subject.lead)} flow`,
  );
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    subject.kind === 'edit' ? draftOf(subject.flow) : [newStep(firstReport(chart, lead))],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const input = toInput(steps);
      const trimmed = name.trim();
      if (subject.kind === 'create') {
        onSaved(await calls.createFlow({ leadPrincipalId: lead, name: trimmed, steps: input }));
        return;
      }
      let flow = await calls.putSteps(subject.flow.id, input);
      if (trimmed !== subject.flow.name) flow = await calls.renameFlow(flow.id, trimmed);
      onSaved(flow);
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  const add = () => setSteps((was) => [...was, newStep(was.at(-1)?.assignee ?? firstReport(chart, lead))]);
  return { name, setName, steps, setSteps, busy, error, save, add };
}

type Editor = ReturnType<typeof useEditor>;

/** The editor's top row: the flow's name, then Cancel and Save (Create flow for a new one). */
function EditorBar({
  editor,
  create,
  onCancel,
}: {
  readonly editor: Editor;
  readonly create: boolean;
  readonly onCancel: () => void;
}) {
  const ready = draftReady(editor.steps) && editor.name.trim().length >= FLOW_NAME.min;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        size="sm"
        aria-label="Flow name"
        maxLength={FLOW_NAME.max}
        value={editor.name}
        onChange={(event) => editor.setName(event.target.value)}
        className="w-72! max-w-full font-semibold"
      />
      <div className="ml-auto flex gap-2">
        <Button size="sm" tone="quiet" onClick={onCancel} disabled={editor.busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          tone="primary"
          busy={editor.busy}
          disabled={!ready}
          onClick={() => void editor.save()}
        >
          {create ? 'Create flow' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The flow editor, in place of the drawing: the flow's name, a live drawing of the draft, then each step (name, kind,
 * assignee, Starts, Comes back again, Sends back to, limit; reordered by its handle or Up and Down; removed), Add a
 * step, and Save or Cancel. The server's refusals (a removed step with tasks, `step_has_tasks`, names them) show
 * above the buttons.
 */
export function FlowEditor({
  subject,
  chart,
  calls,
  meUserId,
  onSaved,
  onCancel,
}: {
  readonly subject: EditorSubject;
  readonly chart: OrgChart;
  readonly calls: FlowCalls;
  readonly meUserId: string;
  readonly onSaved: (flow: Flow) => void;
  readonly onCancel: () => void;
}) {
  const editor = useEditor(subject, chart, calls, onSaved);
  const { steps, setSteps } = editor;
  const nodes = useMemo(() => nodesById(chart.nodes), [chart]);
  const assignees = useMemo(() => assigneeOptions(chart.nodes, meUserId), [chart, meUserId]);
  const drag = useStepDrag((from, to) => setSteps((was) => moveStep(was, from, to)));
  const isAgent = (principalId: string) => nodes.get(principalId)?.kind === 'agent';
  return (
    <Card padding="sm" className="flex flex-col gap-4">
      <EditorBar editor={editor} create={subject.kind === 'create'} onCancel={onCancel} />
      {editor.error && <Notice tone="error">{editor.error}</Notice>}
      <FlowDrawing steps={drawnDraft(steps, nodes)} nodes={nodes} />
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <StepRow
            key={step.key}
            steps={steps}
            index={index}
            assignees={assignees}
            isAgent={isAgent}
            problem={problemOf(steps, index)}
            drag={drag(index)}
            onChange={(change) => setSteps((was) => changeStep(was, step.key, change))}
            onMove={(to) => setSteps((was) => moveStep(was, index, to))}
            onRemove={() => setSteps((was) => removeStep(was, step.key))}
          />
        ))}
      </ol>
      <div>
        <Button
          size="sm"
          tone="soft"
          icon={Plus}
          disabled={steps.length >= FLOW_STEPS_MAX}
          onClick={editor.add}
        >
          Add a step
        </Button>
      </div>
    </Card>
  );
}
