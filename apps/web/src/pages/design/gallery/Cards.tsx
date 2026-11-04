import { KeyRound, Mail, Users } from 'lucide-react';
import { StatTile } from '../../../components/data/StatTile.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Example, Section } from './Section.tsx';

function CardVariants() {
  return (
    <Example label="Card variants" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" wrap={false}>
      <Card>
        <p className="font-bold">Plain</p>
        <p className="mt-1 text-sm text-dim">White, soft shadow, 24px radius.</p>
      </Card>
      <Card variant="soft">
        <p className="font-bold">Soft</p>
        <p className="mt-1 text-sm text-dim">A tinted inset inside another card.</p>
      </Card>
      <Card variant="ink">
        <p className="font-bold">Ink</p>
        <p className="mt-1 text-sm text-white/75">The dark card, for a callout or a tooltip-like note.</p>
      </Card>
      <Card variant="hero" className="sm:col-span-2 lg:col-span-2">
        <p className="text-xs font-semibold text-white/75">Hero</p>
        <p className="mt-1 text-3xl font-extrabold tracking-[-0.03em]">Most Wanted Corp</p>
        <p className="mt-1 text-sm text-white/80">
          The blue gradient with the soft rings; one per page at most.
        </p>
        <div className="mt-4 flex gap-2">
          <Button tone="inverse" size="sm">
            Invite
          </Button>
          <Button tone="inverse-soft" size="sm">
            Create a key
          </Button>
        </div>
      </Card>
      <Card variant="teal">
        <p className="text-xs font-semibold text-white/75">Teal</p>
        <p className="mt-1 text-xl font-extrabold tracking-[-0.02em]">Your AI team</p>
        <p className="mt-1 text-sm text-white/80">The second accent, for what comes next.</p>
      </Card>
    </Example>
  );
}

function PanelsAndStats() {
  return (
    <>
      <Example label="Panel" className="grid gap-3 lg:grid-cols-2" wrap={false}>
        <Panel
          title="People"
          description="Who is in the company and what they may do."
          actions={<Switch checked label="Show everyone" onChange={() => undefined} />}
        >
          <p className="text-sm text-ink-2">The content of the panel sits here, under its header.</p>
        </Panel>
        <Panel
          tone="danger"
          title="Delete this company"
          description="Everyone loses access at once. There is no undo in the app."
        >
          <Button tone="danger" disabled>
            Delete company
          </Button>
        </Panel>
      </Example>
      <Example label="StatTile" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" wrap={false}>
        <StatTile
          label="Members"
          value={12}
          icon={Users}
          delta={{ value: '+2 this week', direction: 'up' }}
        />
        <StatTile
          label="Pending invitations"
          value={3}
          icon={Mail}
          tone="input"
          hint="Expire after 14 days"
        />
        <StatTile
          label="Your API keys"
          value={1}
          icon={KeyRound}
          tone="teal"
          href="#cards"
          hint="Opens the keys page"
        />
        <StatTile label="Runs today" value={0} loading />
      </Example>
    </>
  );
}

export function CardsSection() {
  return (
    <Section
      id="cards"
      title="Card, Panel, StatTile"
      description="One surface, five variants; a Panel is a titled card; a StatTile is a number with its context."
    >
      <CardVariants />
      <PanelsAndStats />
    </Section>
  );
}
