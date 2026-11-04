import { ArrowRight, Bell, LayoutGrid, Plus, Settings, Trash2, Users } from 'lucide-react';
import { Button, type ButtonTone } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { Example, Section } from './Section.tsx';

const TONES: readonly ButtonTone[] = ['primary', 'secondary', 'soft', 'quiet', 'danger'];

function ButtonExamples() {
  return (
    <>
      <Example label="Tones">
        {TONES.map((tone) => (
          <Button key={tone} tone={tone}>
            {tone === 'danger' ? 'Delete' : tone === 'quiet' ? 'Cancel' : 'Save changes'}
          </Button>
        ))}
      </Example>
      <Example label="Sizes and icons">
        <Button size="sm" icon={Plus}>
          Invite
        </Button>
        <Button tone="primary" icon={Plus}>
          Create an API key
        </Button>
        <Button size="lg" tone="primary" trailingIcon={ArrowRight}>
          Continue
        </Button>
        <Button tone="danger" icon={Trash2} size="sm">
          Revoke
        </Button>
      </Example>
      <Example label="Busy and disabled">
        <Button tone="primary" busy>
          Saving
        </Button>
        <Button busy>Syncing</Button>
        <Button tone="primary" disabled>
          Send invitation
        </Button>
        <Button disabled>Cancel</Button>
      </Example>
    </>
  );
}

function IconButtonExamples() {
  return (
    <>
      <Example label="On a gradient card" wrap={false}>
        <Card variant="hero" padding="sm" className="flex flex-wrap items-center gap-2.5">
          <Button tone="inverse" icon={Plus}>
            Invite a teammate
          </Button>
          <Button tone="inverse-soft">Create an API key</Button>
          <IconButton label="Settings" icon={Settings} tone="inverse" />
        </Card>
      </Example>
      <Example label="IconButton tones, the active rail item, a count badge">
        <IconButton label="Overview" icon={LayoutGrid} tooltip="top" />
        <IconButton label="Members" icon={Users} tone="soft" tooltip="top" />
        <IconButton label="Settings" icon={Settings} tone="solid" tooltip="top" />
        <IconButton label="Create" icon={Plus} tone="primary" round tooltip="top" />
        <IconButton label="Overview, current" icon={LayoutGrid} active size="lg" tooltip="top" />
        <IconButton
          label="Attention required: 3"
          icon={Bell}
          tone="solid"
          size="lg"
          badge={3}
          className="rounded-full"
        />
        <IconButton label="Members (coming soon)" icon={Users} aria-disabled="true" tooltip="top" />
      </Example>
    </>
  );
}

export function ButtonsSection() {
  return (
    <Section
      id="buttons"
      title="Button"
      description="Pills, one tone per job. Icons lead; busy shows a spinner."
    >
      <ButtonExamples />
      <IconButtonExamples />
    </Section>
  );
}
