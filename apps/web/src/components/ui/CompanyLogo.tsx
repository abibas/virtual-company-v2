import { cx } from '../cx.ts';
import { initials } from './Avatar.tsx';

export type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Readonly<Record<LogoSize, string>> = {
  xs: 'size-6 rounded-sm text-2xs',
  sm: 'size-8 rounded-md text-xs',
  md: 'size-10 rounded-lg text-md',
  lg: 'size-16 rounded-xl text-2xl',
  xl: 'size-24 rounded-2xl text-3xl',
};

export interface CompanyLogoProps {
  readonly name: string;
  /** The logo image (an object URL from `useCompanyLogo`, or a preview); without one the initials show. */
  readonly src?: string | null | undefined;
  readonly size?: LogoSize;
  /** On a gradient card: a white tile with the initials in blue, so it stands out from the gradient. */
  readonly inverse?: boolean;
  readonly className?: string;
}

/**
 * A company's face wherever it appears: its logo on a white tile, else its initials on the brand gradient. A
 * rounded square, so it reads as a place and not as a person.
 */
export function CompanyLogo({ name, src, size = 'md', inverse = false, className }: CompanyLogoProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-extrabold tracking-[-0.02em] select-none',
        SIZES[size],
        src ? 'bg-white' : inverse ? 'bg-white text-blue-strong' : 'gradient-mark text-white',
        className,
      )}
    >
      {src ? (
        <>
          <img src={src} alt="" className="size-full object-contain" />
          <span className="absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset" />
        </>
      ) : (
        initials(name)
      )}
    </span>
  );
}
