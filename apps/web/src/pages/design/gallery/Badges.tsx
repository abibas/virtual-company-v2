import { KeyRound, Sparkles } from 'lucide-react';
import { AgentFace } from '../../../components/feed/AgentFace.tsx';
import { ATTENTION_KINDS, KINDS } from '../../../components/feed/kinds.ts';
import { KbdHint } from '../../../components/forms/KbdHint.tsx';
import { Avatar, AvatarStack } from '../../../components/ui/Avatar.tsx';
import { Badge, StatusPill, type Tone } from '../../../components/ui/Badge.tsx';
import { CompanyLogo, type LogoSize } from '../../../components/ui/CompanyLogo.tsx';
import { IconTile } from '../../../components/ui/IconTile.tsx';
import { SAMPLE_LOGO_SRC } from '../sample.ts';
import { Example, Section } from './Section.tsx';

const LOGO_SIZES: readonly LogoSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

const TONES: readonly Tone[] = [
  'neutral',
  'blue',
  'teal',
  'input',
  'blocked',
  'review',
  'failed',
  'done',
  'pending',
];
const STATUSES = [
  'active',
  'invited',
  'suspended',
  'removed',
  'pending',
  'accepted',
  'revoked',
  'expired',
  'failed',
  'provisioning',
  'sent',
  'sending',
];
const PEOPLE = [
  { name: 'Ihor Herasko' },
  { name: 'Olena Marsh' },
  { name: 'Theo Laurent' },
  { name: 'Nadia Qureshi' },
  { name: 'Sam Oduya' },
  { name: 'Mira Kell' },
];

function BadgeExamples() {
  return (
    <>
      <Example label="Badge tones (soft)">
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone} dot>
            {tone}
          </Badge>
        ))}
      </Example>
      <Example label="Badge solid, outline, with an icon, small">
        <Badge tone="blue" variant="solid">
          Owner
        </Badge>
        <Badge tone="done" variant="outline">
          Active
        </Badge>
        <Badge tone="teal" icon={Sparkles}>
          Coming in S2
        </Badge>
        <Badge tone="review" size="sm">
          3 for review
        </Badge>
      </Example>
      <Example label="StatusPill: every status the pages show">
        {STATUSES.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </Example>
      <Example label="The attention kinds: tile, word, meaning" wrap={false}>
        {ATTENTION_KINDS.map((kind) => (
          <div key={kind} className="flex items-center gap-3">
            <IconTile icon={KINDS[kind].icon} tone={KINDS[kind].tone} />
            <span className="w-24 text-sm font-bold" style={{ color: `var(--${KINDS[kind].tone})` }}>
              {KINDS[kind].word}
            </span>
            <span className="text-sm text-dim">{KINDS[kind].meaning}</span>
          </div>
        ))}
      </Example>
    </>
  );
}

function AvatarExamples() {
  return (
    <>
      <Example label="Avatar sizes, an image, a face, a selected one">
        <Avatar name="Ihor Herasko" size="xs" />
        <Avatar name="Ihor Herasko" size="sm" />
        <Avatar name="Ihor Herasko" size="md" />
        <Avatar name="Olena Marsh" size="lg" />
        <Avatar name="Theo Laurent" size="xl" />
        <Avatar name="Scout" size="lg" fallback={<AgentFace variant={0} />} />
        <Avatar name="Mason" size="lg" fallback={<AgentFace variant={1} />} selected />
        <Avatar name="Juno" size="lg" shape="rounded" fallback={<AgentFace variant={2} />} />
      </Example>
      <Example label="AvatarStack and the drawn faces">
        <AvatarStack people={PEOPLE} max={4} />
        <AvatarStack people={PEOPLE.slice(0, 3)} size="md" />
        {[0, 1, 2, 3, 4, 5].map((variant) => (
          <Avatar
            key={variant}
            name={`Agent ${variant}`}
            size="lg"
            fallback={<AgentFace variant={variant} />}
          />
        ))}
      </Example>
      <Example label="CompanyLogo sizes: the initials on the gradient, an image, and inverse on a gradient card">
        {LOGO_SIZES.map((size) => (
          <CompanyLogo key={size} name="Most Wanted" size={size} />
        ))}
        <CompanyLogo name="Most Wanted" size="md" src={SAMPLE_LOGO_SRC} />
        <CompanyLogo name="Most Wanted" size="lg" src={SAMPLE_LOGO_SRC} />
        <span className="gradient-hero inline-flex items-center gap-3 rounded-xl p-3">
          <CompanyLogo name="Most Wanted" size="md" inverse />
          <CompanyLogo name="Most Wanted" size="md" src={SAMPLE_LOGO_SRC} inverse />
        </span>
      </Example>
      <Example label="IconTile sizes and KbdHint">
        <IconTile icon={KeyRound} size="sm" tone="teal" />
        <IconTile icon={KeyRound} size="md" tone="blue" />
        <IconTile icon={KeyRound} size="lg" tone="review" />
        <IconTile icon={KeyRound} size="xl" tone="neutral" />
        <KbdHint keys={['⌘', 'K']} />
        <KbdHint keys={['Esc']} />
      </Example>
    </>
  );
}

export function BadgesSection() {
  return (
    <Section
      id="badges"
      title="Badge, StatusPill, Avatar, CompanyLogo, IconTile"
      description="The status palette carries the six attention kinds; everything else is quiet."
    >
      <BadgeExamples />
      <AvatarExamples />
    </Section>
  );
}
