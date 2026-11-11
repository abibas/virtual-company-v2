import type { FlowStepKind, StepOnReturn, TaskPriority, TaskState, TaskStepState } from '@mwc/shared/enums';
import type { Tone } from '../../components/ui/Badge.tsx';

/**
 * How the flows' pages show a step's kind, a task's state, its step state and its priority: the words and the colours,
 * from the design tokens (light and dark). Work is blue, Check amber, Sign-off violet (docs/processes.md).
 */

export interface KindLook {
  readonly label: string;
  readonly tone: Tone;
  /** The kind's text colour. */
  readonly text: string;
  /** Its soft fill. */
  readonly soft: string;
  /** Its solid fill (a bar, a dot). */
  readonly solid: string;
  /** Its ring (a highlighted box). */
  readonly ring: string;
  /** Its stroke, for the drawing's arrows (a CSS colour). */
  readonly stroke: string;
}

export const KIND: Readonly<Record<FlowStepKind, KindLook>> = {
  work: {
    label: 'Work',
    tone: 'blue',
    text: 'text-blue',
    soft: 'bg-blue-soft',
    solid: 'bg-blue',
    ring: 'ring-blue',
    stroke: 'var(--blue)',
  },
  check: {
    label: 'Check',
    tone: 'input',
    text: 'text-input',
    soft: 'bg-input-soft',
    solid: 'bg-input',
    ring: 'ring-input',
    stroke: 'var(--input)',
  },
  signoff: {
    label: 'Sign-off',
    tone: 'review',
    text: 'text-review',
    soft: 'bg-review-soft',
    solid: 'bg-review',
    ring: 'ring-review',
    stroke: 'var(--review)',
  },
};

export const KIND_ORDER: readonly FlowStepKind[] = ['work', 'check', 'signoff'];

/** "Keep ↻" and "Fresh ✦": what a step does when the same task comes back. */
export const RETURN_MARK: Readonly<Record<StepOnReturn, { readonly mark: string; readonly label: string }>> =
  {
    keep: { mark: '↻', label: 'Keep' },
    fresh: { mark: '✦', label: 'Fresh' },
  };

/** A step state's words and tone; `needs_person` says "Needs you" to the person it waits for. */
export function stepStateLook(state: TaskStepState, mine = false): { label: string; tone: Tone } {
  switch (state) {
    case 'waiting':
      return { label: 'Waiting', tone: 'pending' };
    case 'working':
      return { label: 'Working', tone: 'blue' };
    case 'needs_person':
      return { label: mine ? 'Needs you' : 'Needs a person', tone: 'input' };
    case 'blocked':
      return { label: 'Blocked', tone: 'blocked' };
    case 'ended_without_handoff':
      return { label: 'Ended without hand-off', tone: 'failed' };
  }
}

export const TASK_STATE: Readonly<Record<TaskState, { readonly label: string; readonly tone: Tone }>> = {
  queued: { label: 'Queued', tone: 'pending' },
  active: { label: 'Active', tone: 'blue' },
  escalated: { label: 'Escalated', tone: 'blocked' },
  done: { label: 'Done', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'pending' },
};

export const PRIORITY: Readonly<Record<TaskPriority, { readonly label: string; readonly tone: Tone }>> = {
  urgent: { label: 'Urgent', tone: 'failed' },
  high: { label: 'High', tone: 'input' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Low', tone: 'pending' },
};

export const PRIORITY_ORDER: readonly TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
