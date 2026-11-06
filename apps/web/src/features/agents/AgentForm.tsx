import { AGENT_FACE, AGENT_INSTRUCTIONS_MAX, AGENT_NAME, AGENT_ROLE_TITLE, agentFace } from '@mwc/shared/org';
import { type ReactNode, useId } from 'react';
import type { AgentDetail, OrgChart } from '../../api/types.ts';
import { FacePicker } from '../../components/feed/FacePicker.tsx';
import type { AgentRef } from '../../components/feed/kinds.ts';
import { ChoiceField, Field, TextField } from '../../components/forms/Field.tsx';
import { Select, Textarea } from '../../components/forms/Input.tsx';
import { PrincipalSelect } from '../../components/org/PrincipalSelect.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';
import { ModelPanel } from './ModelFields.tsx';

/** Every drawn face, as choices of the face picker. */
const FACES: readonly AgentRef[] = Array.from(
  { length: AGENT_FACE.max - AGENT_FACE.min + 1 },
  (_, index) => ({
    id: String(AGENT_FACE.min + index),
    name: `Face ${index + 1}`,
    face: AGENT_FACE.min + index,
  }),
);

interface PartProps {
  readonly draft: AgentDraft;
  readonly readOnly: boolean;
}

/** The face: drawn from the name until one is picked, and back to the name's on request. */
function FaceChoice({ draft }: { readonly draft: AgentDraft }) {
  const named = draft.face === agentFace(draft.slug);
  const hint = named ? (
    'Drawn from its name until you pick another.'
  ) : (
    <button
      type="button"
      onClick={() => draft.set('face', null)}
      className="cursor-pointer font-semibold text-blue hover:underline"
    >
      Use the face of its name
    </button>
  );
  return (
    <ChoiceField label="Face" hint={hint}>
      <FacePicker
        agents={FACES}
        value={String(draft.face)}
        onChange={(id) => draft.set('face', Number(id))}
        label="Face"
        size="sm"
        className="gap-1.5"
      />
    </ChoiceField>
  );
}

/** Who the agent is: its name (and the handle it makes), its job on the chart and its face. */
function IdentityPanel({ draft, readOnly, isNew }: PartProps & { readonly isNew: boolean }) {
  const { values, set } = draft;
  return (
    <Panel title="Who it is" description="Its name, its job on the chart and its face.">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            readOnly={readOnly}
            required
            maxLength={AGENT_NAME.max}
            placeholder="Scout"
            autoFocus={isNew}
            hint={
              isNew &&
              (values.name.trim() ? (
                <>
                  Its handle: <span className="font-mono text-ink-2">{draft.slug}</span>
                </>
              ) : (
                'Its handle comes from the name.'
              ))
            }
          />
          <TextField
            label="Role title"
            value={values.roleTitle}
            onChange={(event) => set('roleTitle', event.target.value)}
            readOnly={readOnly}
            required
            maxLength={AGENT_ROLE_TITLE.max}
            placeholder="Researcher, Coder, QA…"
          />
        </div>
        {!readOnly && <FaceChoice draft={draft} />}
      </div>
    </Panel>
  );
}

/** Its manager on the chart; an archived agent has none until it is restored. */
function PlacePanel({
  draft,
  readOnly,
  chart,
  agent,
  meUserId,
}: PartProps & {
  readonly chart: OrgChart | undefined;
  readonly agent: AgentDetail | undefined;
  readonly meUserId: string;
}) {
  const id = useId();
  const subject = { kind: 'agent' as const, ...(agent ? { principalId: agent.principalId } : {}) };
  return (
    <Panel
      title="Place on the chart"
      description="Agents report to a person or to another agent, and every chain ends with a person."
    >
      {agent?.status === 'archived' ? (
        <p className="text-sm text-dim">Archived, so off the chart. Restored, it reports to you.</p>
      ) : (
        <Field label="Reports to" id={id} className="max-w-md">
          {chart ? (
            <PrincipalSelect
              id={id}
              nodes={chart.nodes}
              tree={chart.tree}
              subject={subject}
              value={draft.values.reportsTo}
              onChange={(principalId) => draft.set('reportsTo', principalId)}
              meUserId={meUserId}
              disabled={readOnly}
            />
          ) : (
            <Select id={id} disabled options={[{ value: '', label: 'Loading the chart…' }]} />
          )}
        </Field>
      )}
    </Panel>
  );
}

/** The standing instructions: a large monospace field with its length, and the revision they are at. */
function InstructionsPanel({
  draft,
  readOnly,
  agent,
}: PartProps & { readonly agent: AgentDetail | undefined }) {
  const id = useId();
  const length = draft.values.instructions.length;
  return (
    <Panel
      title="Instructions"
      description="What it always knows: its job, its rules, how it hands work back. Changing them makes a new revision."
      actions={agent && <Badge tone="teal">Revision {agent.instructionsRev}</Badge>}
    >
      <label htmlFor={id} className="sr-only">
        Instructions
      </label>
      <Textarea
        id={id}
        value={draft.values.instructions}
        onChange={(event) => draft.set('instructions', event.target.value)}
        readOnly={readOnly}
        maxLength={AGENT_INSTRUCTIONS_MAX}
        rows={16}
        spellCheck={false}
        placeholder="Who it is, what it does, its rules, and how it hands work back. Markdown is fine."
        aria-describedby={`${id}-count`}
        className="font-mono leading-relaxed"
      />
      <p id={`${id}-count`} className="mt-2 text-right text-xs text-dim tabular">
        {length.toLocaleString()} of {AGENT_INSTRUCTIONS_MAX.toLocaleString()} characters
      </p>
    </Panel>
  );
}

/**
 * The form's bar, kept in view at the bottom while the long form scrolls (above the phone's tab bar): where the form
 * stands, or the server's refusal, and its buttons.
 */
export function FormActions({
  status,
  error,
  children,
}: {
  readonly status: ReactNode;
  /** The refusal of the last try, in plain words. */
  readonly error: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="sticky bottom-24 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-glass p-3 pl-4 shadow-raised ring-1 ring-line backdrop-blur-md md:bottom-4">
      {error ? (
        <p role="alert" className="min-w-0 flex-1 text-sm font-medium text-failed">
          {error}
        </p>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-dim">{status}</p>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export interface AgentFormProps {
  readonly draft: AgentDraft;
  /** The chart, for the manager's choices (a waiting select until it loads). */
  readonly chart: OrgChart | undefined;
  /** The agent being edited; none for a new one. */
  readonly agent?: AgentDetail | undefined;
  readonly meUserId: string;
  /** Viewers and members: the same fields, shown and not changeable. */
  readonly readOnly?: boolean;
}

/**
 * The agent's fields, in four panels: who it is, how it works (with its access profile), its place, its
 * instructions.
 */
export function AgentForm({ draft, chart, agent, meUserId, readOnly = false }: AgentFormProps) {
  return (
    <div className="grid gap-4 md:gap-5">
      <IdentityPanel draft={draft} readOnly={readOnly} isNew={agent === undefined} />
      <ModelPanel draft={draft} readOnly={readOnly} agent={agent} meUserId={meUserId} />
      <PlacePanel draft={draft} readOnly={readOnly} chart={chart} agent={agent} meUserId={meUserId} />
      <InstructionsPanel draft={draft} readOnly={readOnly} agent={agent} />
    </div>
  );
}
