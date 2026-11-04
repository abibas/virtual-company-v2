import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

/** The status palette: the six attention kinds, the brand colours, neutral, and `inverse` for the gradient cards. */
export type Tone =
  | 'neutral'
  | 'blue'
  | 'teal'
  | 'input'
  | 'blocked'
  | 'review'
  | 'failed'
  | 'done'
  | 'pending'
  | 'inverse';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

/** `[soft background + text, solid background + text, the dot]` for every tone. */
const TONES: Readonly<Record<Tone, readonly [string, string, string]>> = {
  neutral: ['bg-surface-3 text-ink-2', 'bg-ink text-canvas', 'bg-ink-2'],
  blue: ['bg-blue-soft text-blue', 'bg-blue text-on-blue', 'bg-blue'],
  teal: ['bg-teal-soft text-teal', 'bg-teal text-on-teal', 'bg-teal'],
  input: ['bg-input-soft text-input', 'bg-input text-white', 'bg-input'],
  blocked: ['bg-blocked-soft text-blocked', 'bg-blocked text-white', 'bg-blocked'],
  review: ['bg-review-soft text-review', 'bg-review text-white', 'bg-review'],
  failed: ['bg-failed-soft text-failed', 'bg-failed text-white', 'bg-failed'],
  done: ['bg-done-soft text-done', 'bg-done text-white', 'bg-done'],
  pending: ['bg-pending-soft text-pending', 'bg-pending text-white', 'bg-pending'],
  inverse: ['bg-white/18 text-white', 'bg-white text-ink', 'bg-white'],
};

export interface BadgeProps {
  readonly tone?: Tone;
  readonly variant?: BadgeVariant;
  readonly size?: 'sm' | 'md' | undefined;
  /** A coloured dot before the words (colour is never the only signal: the words are). */
  readonly dot?: boolean;
  readonly icon?: LucideIcon | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/** A small rounded label: a status, a count, a role. */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  dot = false,
  icon: Icon,
  className,
  children,
}: BadgeProps) {
  const [soft, solid, dotClass] = TONES[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs',
        variant === 'soft' && soft,
        variant === 'solid' && solid,
        variant === 'outline' && cx('ring-1 ring-line-2 ring-inset', soft.split(' ')[1]),
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', dotClass)} />}
      {Icon && <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.5} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Every status the identity pages show, with its tone and its words. */
const STATUSES: Readonly<Record<string, readonly [Tone, string]>> = {
  active: ['done', 'Active'],
  invited: ['input', 'Invited'],
  suspended: ['blocked', 'Suspended'],
  removed: ['pending', 'Removed'],
  pending: ['input', 'Pending'],
  accepted: ['blue', 'Accepted'],
  revoked: ['pending', 'Revoked'],
  expired: ['pending', 'Expired'],
  failed: ['failed', 'Failed'],
  provisioning: ['input', 'Setting up'],
  deleted: ['pending', 'Deleted'],
  sent: ['done', 'Email sent'],
  sending: ['input', 'Sending'],
};

/** A status as a dot and a word, in the tone of its meaning; `inverse` on a gradient card. */
export function StatusPill({
  status,
  inverse = false,
  size,
}: {
  readonly status: string;
  readonly inverse?: boolean;
  readonly size?: 'sm' | 'md' | undefined;
}) {
  const [tone, words] = STATUSES[status] ?? (['pending', status] as const);
  return (
    <Badge tone={inverse ? 'inverse' : tone} dot={!inverse} size={size}>
      {words}
    </Badge>
  );
}

const ROLES: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** A membership role as people read it. */
export function roleName(role: string): string {
  return ROLES[role] ?? role;
}
