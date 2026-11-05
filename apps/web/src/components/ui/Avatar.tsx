import { type ReactNode, useState } from 'react';
import { cx } from '../cx.ts';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZES: Readonly<Record<AvatarSize, string>> = {
  xs: 'size-6 text-2xs',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-16 text-xl',
  '2xl': 'size-24 text-3xl',
};

/** The tinted pairs a name is mapped to, so the same person always gets the same colour. */
const TINTS = [
  'bg-blue-soft text-blue',
  'bg-teal-soft text-teal',
  'bg-review-soft text-review',
  'bg-input-soft text-input',
  'bg-done-soft text-done',
  'bg-blocked-soft text-blocked',
] as const;

/** The first letters of the first two words ("Ihor Herasko" → "IH"; an email → its first letter). */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1 || name.includes('@')) return (words[0]?.[0] ?? '?').toUpperCase();
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

/** The name a person goes by here: their display name, else (while they have not given one) their email. */
export function personName(displayName: string | null | undefined, email: string): string {
  return displayName?.trim() || email;
}

/** A stable tint for a name. */
export function tintOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0];
}

export interface AvatarProps {
  readonly name: string;
  readonly src?: string | null | undefined;
  readonly size?: AvatarSize;
  readonly shape?: 'circle' | 'rounded';
  /** Drawn instead of the initials when there is no image (an agent's face). */
  readonly fallback?: ReactNode;
  /** The initials on a tint of the name's own (the default), or white on the brand gradient (the signed-in person). */
  readonly tone?: 'tint' | 'gradient';
  /** A blue ring (the selected face in a picker). */
  readonly selected?: boolean;
  readonly className?: string;
}

/**
 * A person or an agent: their photo, else their face, else their initials on a tint of their own (or the gradient).
 * A photo that does not load (gone, or blocked) gives way to the initials.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  fallback,
  tone = 'tint',
  selected = false,
  className,
}: AvatarProps) {
  const [broken, setBroken] = useState<string>();
  const image = src && src !== broken ? src : null;
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  return (
    <span
      aria-hidden="true"
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-bold select-none',
        SIZES[size],
        radius,
        !image && !fallback && (tone === 'gradient' ? 'gradient-mark text-white' : tintOf(name)),
        selected && 'ring-2 ring-blue ring-offset-2 ring-offset-surface',
        className,
      )}
    >
      {image ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(image)}
          className="size-full object-cover"
        />
      ) : (
        (fallback ?? initials(name))
      )}
    </span>
  );
}

export interface StackedPerson {
  /** What tells two people of the same name apart (an agent's id); the name when absent. */
  readonly id?: string;
  readonly name: string;
  readonly src?: string | null | undefined;
  readonly fallback?: ReactNode;
}

/** A row of overlapping avatars, with "+N" for the ones past `max`. */
export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
  ring = 'ring-surface',
  className,
}: {
  readonly people: readonly StackedPerson[];
  readonly max?: number;
  readonly size?: AvatarSize;
  /** The ring class separating the faces: the surface they sit on. */
  readonly ring?: string;
  readonly className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cx('inline-flex items-center', className)} aria-hidden="true">
      {shown.map((person, index) => (
        <Avatar
          key={person.id ?? person.name}
          name={person.name}
          src={person.src}
          fallback={person.fallback}
          size={size}
          className={cx('ring-2', ring, index > 0 && '-ml-2.5')}
        />
      ))}
      {rest > 0 && (
        <span
          className={cx(
            '-ml-2.5 inline-flex items-center justify-center rounded-full bg-surface-3 font-bold text-ink-2 ring-2 tabular',
            ring,
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
