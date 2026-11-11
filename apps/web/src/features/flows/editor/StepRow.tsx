import type { FlowStepKind } from '@mwc/shared/enums';
import { STEP_NAME } from '@mwc/shared/flows';
import { ArrowDown, ArrowUp, GripVertical, Trash } from 'lucide-react';
import type { DragEvent } from 'react';
import { cx } from '../../../components/cx.ts';
import { Input, Select, type SelectOption } from '../../../components/forms/Input.tsx';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { KIND, KIND_ORDER } from '../words.ts';
import type { DraftStep } from './draft.ts';
import { StepOptions } from './StepOptions.tsx';

/** What a row's drag handle and its drop zone do (`use-step-drag.ts`). */
export interface RowDrag {
  readonly dragging: boolean;
  /** A dragged step would land here. */
  readonly over: boolean;
  onHandleStart(event: DragEvent<HTMLElement>): void;
  onOver(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
  onEnd(): void;
}

export interface StepRowProps {
  readonly steps: readonly DraftStep[];
  readonly index: number;
  /** The company's people and agents, as the assignee's choices. */
  readonly assignees: readonly SelectOption[];
  readonly isAgent: (principalId: string) => boolean;
  readonly problem: string | undefined;
  readonly drag: RowDrag;
  readonly onChange: (change: Partial<DraftStep>) => void;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}

/** The handle (drag it to reorder), with Up and Down beside it for the keyboard and for touch. */
function Handle({ props, name }: { readonly props: StepRowProps; readonly name: string }) {
  const { index, steps, drag } = props;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 py-2 pl-1.5">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer's drag handle; Up and Down below are its keyboard way. */}
      <span
        draggable
        onDragStart={drag.onHandleStart}
        onDragEnd={drag.onEnd}
        title="Drag to reorder"
        className="cursor-grab rounded-sm p-1 text-faint hover:bg-surface-3 hover:text-ink active:cursor-grabbing"
      >
        <GripVertical size={16} aria-hidden="true" />
      </span>
      <IconButton
        label={`Move ${name} up`}
        icon={ArrowUp}
        size="sm"
        disabled={index === 0}
        onClick={() => props.onMove(index - 1)}
      />
      <IconButton
        label={`Move ${name} down`}
        icon={ArrowDown}
        size="sm"
        disabled={index === steps.length - 1}
        onClick={() => props.onMove(index + 1)}
      />
    </div>
  );
}

/** The step's first line: its number, name, kind, assignee and Remove. */
function MainLine({
  props,
  step,
  name,
}: {
  readonly props: StepRowProps;
  readonly step: DraftStep;
  readonly name: string;
}) {
  const { index, onChange } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-5 shrink-0 text-right text-xs font-bold text-faint tabular">{index + 1}</span>
      <Input
        size="sm"
        aria-label={`Step ${index + 1}: name`}
        placeholder="Name it"
        maxLength={STEP_NAME.max}
        value={step.name}
        onChange={(event) => onChange({ name: event.target.value })}
        className="min-w-36 flex-1 basis-40"
      />
      <SegmentedControl<FlowStepKind>
        label={`${name}: kind`}
        size="sm"
        value={step.kind}
        onChange={(kind) => onChange({ kind })}
        options={KIND_ORDER.map((kind) => ({ value: kind, label: KIND[kind].label }))}
      />
      <Select
        size="sm"
        aria-label={`${name}: who does it`}
        className="w-56! max-sm:w-full!"
        value={step.assignee}
        onChange={(event) => onChange({ assignee: event.target.value })}
        options={props.assignees}
      />
      <IconButton label={`Remove ${name}`} icon={Trash} size="sm" onClick={props.onRemove} />
    </div>
  );
}

/**
 * One step in the editor: its kind's bar, the handle, its number, name, kind (Work, Check or Sign-off) and assignee,
 * Remove, then its options (`StepOptions`) and what is wrong with it.
 */
export function StepRow(props: StepRowProps) {
  const { steps, index, drag, onChange } = props;
  const step = steps[index];
  if (!step) return null;
  const name = step.name.trim() || `step ${index + 1}`;
  const target = step.sendsBackTo === null ? -1 : steps.findIndex((other) => other.key === step.sendsBackTo);
  return (
    <li
      onDragOver={drag.onOver}
      onDrop={drag.onDrop}
      className={cx(
        'relative flex overflow-hidden rounded-xl bg-surface ring-1 transition-[box-shadow,opacity]',
        drag.over ? 'ring-2 ring-blue' : 'ring-line',
        drag.dragging && 'opacity-50',
      )}
    >
      <span aria-hidden="true" className={cx('w-1 shrink-0', KIND[step.kind].solid)} />
      <Handle props={props} name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 pr-3 pl-1.5">
        <MainLine props={props} step={step} name={name} />
        <div className="pl-7">
          <StepOptions
            step={step}
            earlier={steps.slice(0, index)}
            later={target > index ? steps[target] : undefined}
            agent={props.isAgent(step.assignee)}
            onChange={onChange}
          />
          {props.problem && <p className="mt-1.5 text-xs font-medium text-failed">{props.problem}</p>}
        </div>
      </div>
    </li>
  );
}
