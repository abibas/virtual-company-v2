import { AGENT_INSTRUCTIONS_MAX, AGENT_NAME, AGENT_ROLE_TITLE } from '@mwc/shared/org';
import { type ReactNode, useId } from 'react';
import type { AgentDetail, OrgChart } from '../../api/types.ts';
import { ChoiceField, Field, TextField } from '../../components/forms/Field.tsx';
import { Select, Textarea } from '../../components/forms/Input.tsx';
import { PrincipalSelect } from '../../components/org/PrincipalSelect.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';
import { CompanyBriefing } from './CompanyBriefing.tsx';
import { IconChoice } from './IconChoice.tsx';
import { ModelPanel, type OwnProfiles } from './ModelFields.tsx';

interface PartProps {
  readonly draft: AgentDraft;
  readonly readOnly: boolean;
}

/** Who the agent is: its name (and the handle it makes), its job on the chart and its icon. */
function IdentityPanel({
  draft,
  readOnly,
  agent,
  reportsTo,
}: PartProps & { readonly agent: AgentDetail | undefined; readonly reportsTo: ReactNode }) {
  const { values, set } = draft;
  const isNew = agent === undefined;
  return (
    <Panel title="Who it is">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              values.name.trim() !== '' && (
                <>
                  Handle: <span className="font-mono text-ink-2">{draft.slug}</span>
                </>
              )
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
          {reportsTo}
        </div>
        {!readOnly && (
          <ChoiceField label="Icon">
            <IconChoice draft={draft} agent={agent} />
          </ChoiceField>
        )}
      </div>
    </Panel>
  );
}

/** Its manager on the chart (a field of Who it is); an archived agent has none until it is restored. */
function ReportsToField({
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
  return agent?.status === 'archived' ? (
    <Field label="Reports to" id={id}>
      <p id={id} className="py-2 text-sm text-dim">
        Archived: off the chart
      </p>
    </Field>
  ) : (
    <Field label="Reports to" id={id}>
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
  );
}

/**
 * The standing instructions: what the company tells the agent (generated, read-only) when there is a briefing, then a
 * large monospace field with its length, and the revision they are at.
 */
function InstructionsPanel({
  draft,
  readOnly,
  agent,
  briefing,
}: PartProps & { readonly agent: AgentDetail | undefined; readonly briefing: Briefing }) {
  const id = useId();
  const length = draft.values.instructions.length;
  return (
    <Panel
      title="Instructions"
      actions={agent && <Badge tone="teal">Revision {agent.instructionsRev}</Badge>}
    >
      {briefing.shown && <CompanyBriefing text={briefing.text} />}
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

/** The briefing above the instructions: shown or not, and its text (undefined while it loads). */
export interface Briefing {
  readonly shown: boolean;
  readonly text: string | undefined;
}

export interface AgentFormProps {
  readonly draft: AgentDraft;
  /** "Where it runs" (`WhereItRuns` on the page's placement draft), at the end of How it works. */
  readonly where: ReactNode;
  /** Under the access profile: whether its harness's CLI is on the chosen machine (`HarnessToolWarning`). */
  readonly profileNote?: ReactNode;
  /** The chart, for the manager's choices (a waiting select until it loads). */
  readonly chart: OrgChart | undefined;
  /** The agent being edited; none for a new one. */
  readonly agent?: AgentDetail | undefined;
  readonly meUserId: string;
  /** Viewers and members: the same fields, shown and not changeable. */
  readonly readOnly?: boolean;
  /** The person's own access profiles (`useAccessProfiles`), for the profile's choices and what it runs. */
  readonly profiles: OwnProfiles;
  /** What the company tells the agent, above its instructions; none on the Hire page until a manager is chosen. */
  readonly briefing?: Briefing;
}

const NO_BRIEFING: Briefing = { shown: false, text: undefined };

/**
 * The agent's fields, in three panels (Ihor: fields, not explanations): who it is (with whom it reports to), how it
 * works (its access profile and where it runs), its instructions.
 */
export function AgentForm({
  draft,
  chart,
  agent,
  meUserId,
  readOnly = false,
  briefing = NO_BRIEFING,
  ...parts
}: AgentFormProps) {
  return (
    <div className="grid gap-4 md:gap-5">
      <IdentityPanel
        draft={draft}
        readOnly={readOnly}
        agent={agent}
        reportsTo={
          <ReportsToField draft={draft} readOnly={readOnly} chart={chart} agent={agent} meUserId={meUserId} />
        }
      />
      <ModelPanel draft={draft} readOnly={readOnly} agent={agent} meUserId={meUserId} {...parts} />
      <InstructionsPanel draft={draft} readOnly={readOnly} agent={agent} briefing={briefing} />
    </div>
  );
}
