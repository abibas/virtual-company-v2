import { Check, KeyRound, LayoutGrid, type LucideIcon, Plus, Settings, Users } from 'lucide-react';
import { cx } from '../cx.ts';
import { CompanyHero } from '../overview/CompanyHero.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { CompanyLogo } from '../ui/CompanyLogo.tsx';

const PAGES: readonly { readonly key: string; readonly icon: LucideIcon }[] = [
  { key: 'overview', icon: LayoutGrid },
  { key: 'members', icon: Users },
  { key: 'api-keys', icon: KeyRound },
  { key: 'settings', icon: Settings },
];
const TILES = [
  ['Members', '1'],
  ['Invitations', '0'],
] as const;
const SUMMARY = 'You own this company: its people, its settings, its agents.';

interface Face {
  readonly name: string;
  readonly src: string | null;
}

/** The rail of the preview: the company's badge, then its pages with the first one current (not on phones). */
function MiniRail({ name, src }: Face) {
  return (
    <div className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-line py-3 sm:flex">
      <CompanyLogo
        name={name}
        src={src}
        size="md"
        className={cx('mb-2', src ? 'shadow-card' : 'shadow-primary')}
      />
      {PAGES.map((page, index) => (
        <span
          key={page.key}
          className={cx(
            'flex size-8 items-center justify-center rounded-md',
            index === 0 ? 'bg-blue text-on-blue shadow-primary' : 'text-faint',
          )}
        >
          <page.icon size={15} strokeWidth={2} />
        </span>
      ))}
    </div>
  );
}

/** The numbers a new company starts with, under the hero. */
function MiniTiles() {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {TILES.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
          <p className="truncate text-2xs font-medium text-dim">{label}</p>
          <p className="text-md font-extrabold tracking-[-0.02em] text-ink tabular">{value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The switcher's line: the company among "Your companies", at its address, as owner. It floats over the corner of
 * the preview; on phones it sits above it.
 */
function SwitcherChip({ name, src, address }: Face & { readonly address: string }) {
  return (
    <div className="mb-3 sm:absolute sm:-top-5 sm:-right-7 sm:z-10 sm:mb-0 sm:w-64 sm:rotate-[2.5deg]">
      <Card padding="sm" className="py-2.5 shadow-raised">
        <p className="text-2xs font-semibold text-dim">Your companies</p>
        <div className="mt-1.5 flex items-center gap-2.5">
          <CompanyLogo name={name} src={src} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{name}</span>
            <span className="block truncate font-mono text-2xs text-dim">/c/{address}</span>
          </span>
          <span className="text-xs text-dim">Owner</span>
          <Check size={14} strokeWidth={2.5} className="shrink-0 text-blue" />
        </div>
      </Card>
    </div>
  );
}

/**
 * The company as its home will show it, drawn from the draft as it is typed: the rail with its badge, the hero with
 * its logo and name, the first numbers, and the switcher's line. An illustration: nothing in it works.
 */
export function CompanyPreview({
  name,
  address,
  logoSrc,
  className,
}: {
  readonly name: string;
  readonly address: string;
  readonly logoSrc: string | null;
  readonly className?: string;
}) {
  const shown = name.trim() || 'Your company';
  const at = address || 'your-address';
  return (
    <div className={cx('relative mx-auto w-full max-w-md', className)} aria-hidden="true" inert>
      <SwitcherChip name={shown} src={logoSrc} address={at} />
      <Card padding="none" className="flex">
        <MiniRail name={shown} src={logoSrc} />
        <div className="min-w-0 flex-1 p-2.5 sm:p-3 sm:pt-8">
          <CompanyHero
            compact
            name={shown}
            status="active"
            logoSrc={logoSrc}
            summary={SUMMARY}
            actions={
              <Button tone="inverse" size="sm" icon={Plus}>
                Invite a teammate
              </Button>
            }
          />
          <MiniTiles />
        </div>
      </Card>
    </div>
  );
}
