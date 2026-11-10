import type { ComponentType } from 'react';

/**
 * What the badges, tiles and list rows draw as their icon: a lucide icon, or any component taking the same few props
 * (the provider logos).
 */
export type IconComponent = ComponentType<{
  readonly size?: number | string;
  readonly strokeWidth?: number | string;
  readonly className?: string;
  readonly 'aria-hidden'?: boolean | 'true' | 'false';
}>;
