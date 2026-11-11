import type { TaskEvent } from '../../../api/flows.ts';
import type { Tone } from '../../../components/ui/Badge.tsx';
import type { Outcome } from './story.ts';

/** Each outcome's chip: its words and tone (from the design tokens, light and dark). */
export const OUTCOME: Readonly<Record<Outcome, { readonly label: string; readonly tone: Tone }>> = {
  handed_on: { label: 'Handed on', tone: 'blue' },
  passed: { label: 'Passed', tone: 'done' },
  approved: { label: 'Approved', tone: 'review' },
  sent_back: { label: 'Sent back', tone: 'blocked' },
  escalated: { label: 'Escalated', tone: 'failed' },
  cancelled: { label: 'Cancelled', tone: 'pending' },
  routed: { label: 'Routed', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'failed' },
  turn_ended: { label: 'Turn ended', tone: 'input' },
  waiting: { label: 'Waiting', tone: 'pending' },
  working: { label: 'Working', tone: 'blue' },
  needs_person: { label: 'Needs a person', tone: 'input' },
};

/** A tone's dot colour (a folded round's steps). */
export const TONE_DOT: Readonly<Record<Tone, string>> = {
  neutral: 'bg-ink-2',
  blue: 'bg-blue',
  teal: 'bg-teal',
  input: 'bg-input',
  blocked: 'bg-blocked',
  review: 'bg-review',
  failed: 'bg-failed',
  done: 'bg-done',
  pending: 'bg-pending',
  inverse: 'bg-white',
};

/** A history row's verb after its actor's name. */
const VERB: Readonly<Record<TaskEvent['kind'], string>> = {
  created: 'created it',
  entered: 'entered',
  started: 'started it',
  handed_on: 'handed it on',
  passed: 'passed it',
  sent_back: 'sent it back',
  escalated: 'escalated it',
  signed_off: 'approved it',
  routed: 'routed it',
  retried: 'retried it',
  done: 'done',
  cancelled: 'cancelled it',
  edited: 'edited',
  blocked: 'blocked',
  turn_ended: 'ended its turn',
};

/** A row's dot colour in the log. */
export const DOT: Readonly<Record<TaskEvent['kind'], string>> = {
  created: 'bg-blue',
  entered: 'bg-faint',
  started: 'bg-blue',
  handed_on: 'bg-blue',
  passed: 'bg-done',
  sent_back: 'bg-blocked',
  escalated: 'bg-failed',
  signed_off: 'bg-review',
  routed: 'bg-ink-2',
  retried: 'bg-ink-2',
  done: 'bg-done',
  cancelled: 'bg-pending',
  edited: 'bg-faint',
  blocked: 'bg-failed',
  turn_ended: 'bg-input',
};

/** Where it moved: "Develop → Code review", "at QA". */
function where(event: TaskEvent): string {
  if (event.from && event.to) return ` · ${event.from.name} → ${event.to.name}`;
  const at = event.to ?? event.from;
  return at ? ` · at ${at.name}` : '';
}

/** One history row in words, without its reason (shown once beside it): who did what, where. */
export function eventWords(event: TaskEvent): string {
  const who = event.actor?.name;
  switch (event.kind) {
    case 'entered':
      return `Entered ${event.to?.name ?? 'a step'}${event.round ? ` · round ${event.round}` : ''}`;
    case 'done':
      return 'Done';
    case 'blocked':
      return `Blocked${where(event)}${who ? ` · by ${who}` : ''}`;
    case 'turn_ended':
      return `Turn ended without a hand-off${where(event)}`;
    case 'escalated':
      return `${who ?? 'Someone'} sent it back over ${event.from?.name ?? 'the step'}'s limit: escalated to the Lead`;
    case 'started':
      if (!event.actor) return `Started by itself${where(event)}`;
      break;
    case 'edited': {
      const fields = Array.isArray(event.details.fields) ? ` the ${event.details.fields.join(', ')}` : '';
      return `${who ?? 'Someone'} edited${fields}`;
    }
  }
  return `${who ?? 'Someone'} ${VERB[event.kind]}${where(event)}`;
}

/** A small line under a step: a person's action or an error, without where (the step says it). */
export function asideWords(event: TaskEvent): string {
  const who = event.actor?.name ?? 'Someone';
  switch (event.kind) {
    case 'blocked':
      return event.actor ? `Blocked by ${who}` : 'Blocked';
    case 'turn_ended':
      return 'Turn ended without a hand-off';
    case 'routed':
    case 'retried':
      return `${who} ${VERB[event.kind]} here`;
    case 'edited':
      return eventWords(event);
    default:
      return `${who} ${VERB[event.kind]}`;
  }
}
