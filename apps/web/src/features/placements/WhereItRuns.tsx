import { useId } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { useMachineChoices } from '../../api/org.ts';
import type { MachineChoice } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Link } from '../../app/router.tsx';
import { ChoiceField, Field } from '../../components/forms/Field.tsx';
import { Select } from '../../components/forms/Input.tsx';
import { SegmentedControl } from '../../components/forms/Segmented.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { HomeFolderField } from './HomeFolderField.tsx';
import { MODE_OPTIONS, type PlacementDraft, POLICY_OPTIONS } from './placement-draft.ts';

type Status = MachineChoice['status'];

/** A machine's status as a toned dot and a word (colour is never the only signal). */
const STATUS: Readonly<Record<Status, readonly ['done' | 'pending' | 'input', string]>> = {
  online: ['done', 'Online'],
  offline: ['pending', 'Offline'],
  draining: ['input', 'Draining'],
};

const NOWHERE = { value: '', label: 'Nowhere yet' };

/** The machine select's options: nowhere, every machine with its status, and the saved one if it is gone. */
function machineOptions(machines: readonly MachineChoice[] | undefined, draft: PlacementDraft) {
  const listed = (machines ?? []).map((m) => ({ value: m.id, label: `${m.name} (${STATUS[m.status][1]})` }));
  const options = [NOWHERE, ...listed];
  const { machineId } = draft.values;
  if (machineId && !machines?.some((m) => m.id === machineId)) {
    options.push({ value: machineId, label: draft.saved?.machineName ?? 'Loading the machines…' });
  }
  return options;
}

/** The hint under the machine select: a load failure, or where machines come from. */
function MachineHint({ count, error, href }: { count: number | undefined; error: unknown; href: string }) {
  if (error !== undefined) return friendlyMessage(error);
  const link = (
    <Link to={href} className="font-semibold text-blue hover:underline">
      Machines
    </Link>
  );
  return count === 0 ? <>No machine yet. {link}</> : undefined;
}

export interface WhereItRunsProps {
  readonly draft: PlacementDraft;
  readonly companyId: string;
  /** The Machines page, where machines are enrolled. */
  readonly machinesHref: string;
  readonly readOnly: boolean;
  /** The agent's slug: the suggested home folder's name (`~/agents/<slug>`). */
  readonly agentSlug: string;
}

/** The machine select, with the chosen machine's status beside it. */
function MachineSelect({
  draft,
  machines,
  machinesHref,
  readOnly,
}: Pick<WhereItRunsProps, 'draft' | 'machinesHref' | 'readOnly'> & {
  readonly machines: Loaded<readonly MachineChoice[]>;
}) {
  const id = useId();
  const chosen = machines.data?.find((m) => m.id === draft.values.machineId);
  const status = chosen?.status ?? draft.saved?.machineStatus;
  const hint = <MachineHint count={machines.data?.length} error={machines.error} href={machinesHref} />;
  return (
    <Field label="Machine" id={id} hint={hint}>
      <div className="flex items-center gap-2">
        <Select
          id={id}
          aria-describedby={`${id}-hint`}
          value={draft.values.machineId}
          options={machineOptions(machines.data, draft)}
          disabled={readOnly}
          onChange={(event) => draft.set('machineId', event.target.value)}
        />
        {draft.values.machineId && status && (
          <Badge tone={STATUS[status][0]} dot size="sm" className="shrink-0">
            {STATUS[status][1]}
          </Badge>
        )}
      </div>
    </Field>
  );
}

/**
 * "Where it runs", in How it works: a machine (or nowhere), the mode, its home folder there (typed, or chosen with
 * Browse… from the machine's folders) and its permissions. The placement is saved with the agent; members and viewers
 * read it.
 */
export function WhereItRuns(props: WhereItRunsProps) {
  const { draft, readOnly, companyId, agentSlug } = props;
  const { values, set } = draft;
  const machines = useMachineChoices(companyId);
  const chosen = machines.data?.find((m) => m.id === values.machineId);
  const placed = values.machineId !== '';
  return (
    <section aria-label="Where it runs" className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <MachineSelect
          draft={draft}
          machines={machines}
          machinesHref={props.machinesHref}
          readOnly={readOnly}
        />
        {placed && (
          <HomeFolderField
            draft={draft}
            companyId={companyId}
            machine={chosen}
            agentSlug={agentSlug}
            readOnly={readOnly}
          />
        )}
      </div>
      {placed && (
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <ChoiceField label="How">
            <SegmentedControl
              label="How it runs"
              options={MODE_OPTIONS}
              value={values.mode}
              onChange={(mode) => set('mode', mode)}
              disabled={readOnly}
              className="max-w-full overflow-x-auto"
            />
          </ChoiceField>
          <ChoiceField label="Permissions" hint="Skip: any tool runs without asking.">
            <SegmentedControl
              label="Permissions"
              options={POLICY_OPTIONS}
              value={values.permissionPolicy}
              onChange={(policy) => set('permissionPolicy', policy)}
              disabled={readOnly}
            />
          </ChoiceField>
        </div>
      )}
    </section>
  );
}
