import type { AgentIconView } from '@mwc/shared/agent-icons';
import { Ban, CircleCheck, CircleX, Clock, Eye, type LucideIcon, MessageCircleQuestion } from 'lucide-react';
import type { Tone } from '../ui/Badge.tsx';

/** What an item of the attention feed asks of the person (S5's inbox kinds). */
export type AttentionKind = 'needs_input' | 'blocked' | 'review' | 'failed' | 'done' | 'pending';

/** An agent as the feed and the quick-create dock show it: a name and a face (an image, or a drawn one). */
export interface AgentRef {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly imageUrl?: string | null;
  /** Which of the drawn faces: the agent's own, and the fallback of its icon. */
  readonly face?: number;
  /** Its icon (`AgentIcon`): the face, an emoji or its image; none draws the face. */
  readonly icon?: AgentIconView;
}

export interface AttentionItem {
  readonly id: string;
  readonly kind: AttentionKind;
  readonly title: string;
  readonly subtitle?: string;
  /** When it happened, ISO. */
  readonly at: string;
  readonly agent?: AgentRef;
  readonly company?: string;
  readonly href?: string;
}

export interface KindStyle {
  /** The status word on the row ("Needs you", "Blocked", ...). */
  readonly word: string;
  readonly tone: Tone;
  readonly icon: LucideIcon;
  /** What the kind means, for the gallery and tooltips. */
  readonly meaning: string;
}

export const KINDS: Readonly<Record<AttentionKind, KindStyle>> = {
  needs_input: {
    word: 'Needs you',
    tone: 'input',
    icon: MessageCircleQuestion,
    meaning: 'An agent asked a question and waits for the answer',
  },
  blocked: { word: 'Blocked', tone: 'blocked', icon: Ban, meaning: 'An agent cannot go on without help' },
  review: { word: 'For review', tone: 'review', icon: Eye, meaning: 'Work is finished and waits for a look' },
  failed: { word: 'Failed', tone: 'failed', icon: CircleX, meaning: 'A run ended with an error' },
  done: { word: 'Done', tone: 'done', icon: CircleCheck, meaning: 'A task was completed' },
  pending: { word: 'Pending', tone: 'pending', icon: Clock, meaning: 'Queued, nothing to do yet' },
};

export const ATTENTION_KINDS = Object.keys(KINDS) as readonly AttentionKind[];
