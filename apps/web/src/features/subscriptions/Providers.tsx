import { PROFILE_PROVIDERS } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { ChevronRight } from 'lucide-react';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import type { IconComponent } from '../../components/ui/icon.ts';
import { ClaudeMark, OpenAIMark } from '../../components/ui/ProviderLogo.tsx';

/**
 * The two access profile providers as the pages show them: how each looks and what it is for (Claude in violet,
 * Anthropic's subscriptions' tone, for Claude Code agents, with an optional gateway; OpenAI in teal, for Codex agents),
 * its badge, and New profile's first step, the choice between them.
 */
interface ProviderStyle {
  readonly name: string;
  readonly tone: Tone;
  /** Its logo (tiles show it on a neutral tile). */
  readonly icon: IconComponent;
  /** The agents its profiles power. */
  readonly agents: string;
  /** What a profile of it holds, as New profile's choice says it. */
  readonly holds: string;
}

export const PROVIDER_STYLES: Readonly<Record<ProfileProvider, ProviderStyle>> = {
  claude: {
    name: 'Claude',
    tone: 'review',
    icon: ClaudeMark,
    agents: 'Claude Code agents',
    holds: 'One Claude subscription, and a gateway if you want one.',
  },
  openai: {
    name: 'OpenAI',
    tone: 'teal',
    icon: OpenAIMark,
    agents: 'Codex agents',
    holds: 'One OpenAI subscription, and an optional gateway for Codex.',
  },
};

/** A profile's provider as a small badge with its icon ("Claude", "OpenAI"). */
export function ProviderBadge({ provider }: { readonly provider: ProfileProvider }) {
  const { name, tone, icon } = PROVIDER_STYLES[provider];
  return (
    <Badge tone={tone} icon={icon} size="sm">
      {name}
    </Badge>
  );
}

/** The first step of New profile: Claude or OpenAI, as two big choices. */
export function ProviderChoice({
  onChoose,
  onCancel,
}: {
  readonly onChoose: (provider: ProfileProvider) => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-md font-bold text-ink">New profile</h2>
          <p className="text-sm text-dim">Which provider is it for? You cannot change it later.</p>
        </div>
        <Button size="sm" tone="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILE_PROVIDERS.map((provider) => {
          const style = PROVIDER_STYLES[provider];
          return (
            <button
              key={provider}
              type="button"
              onClick={() => onChoose(provider)}
              className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-line-2 hover:bg-surface-2"
            >
              <IconTile icon={style.icon} size="xl" />
              <span className="min-w-0 flex-1">
                <span className="block text-md font-bold text-ink">{style.name}</span>
                <span className="block text-xs font-semibold text-ink-2">For {style.agents}</span>
                <span className="mt-1 block text-xs text-dim">{style.holds}</span>
              </span>
              <ChevronRight
                size={18}
                aria-hidden="true"
                className="shrink-0 text-faint group-hover:text-ink-2"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
