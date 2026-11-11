import {
  Ban,
  CircleDot,
  CirclePause,
  type LucideIcon,
  MessageCircleQuestion,
  Stamp,
  TriangleAlert,
} from 'lucide-react';
import type { InboxKind } from '../../api/inbox.ts';
import type { Tone } from '../../components/ui/Badge.tsx';

/**
 * How an inbox item's kind shows (S6b): its chip's word, tone and icon, from the design tokens (light and dark). A
 * Sign-off is violet like its step on the board, a question amber like the agent's question card.
 */
export const INBOX_KIND: Readonly<
  Record<InboxKind, { readonly word: string; readonly tone: Tone; readonly icon: LucideIcon }>
> = {
  signoff: { word: 'Sign-off', tone: 'review', icon: Stamp },
  question: { word: 'Question', tone: 'input', icon: MessageCircleQuestion },
  step: { word: 'Your step', tone: 'blue', icon: CircleDot },
  escalated: { word: 'Escalated', tone: 'failed', icon: TriangleAlert },
  blocked: { word: 'Blocked', tone: 'blocked', icon: Ban },
  turn_ended: { word: 'Turn ended', tone: 'pending', icon: CirclePause },
};
