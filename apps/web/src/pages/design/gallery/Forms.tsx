import { Building2, LayoutGrid, List, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { CopyButton } from '../../../components/forms/CopyButton.tsx';
import { SelectField, TextField } from '../../../components/forms/Field.tsx';
import { Input, Textarea } from '../../../components/forms/Input.tsx';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../../components/forms/Menu.tsx';
import { SearchBox } from '../../../components/forms/SearchBox.tsx';
import { SegmentedControl, Tabs } from '../../../components/forms/Segmented.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Example, Section } from './Section.tsx';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

function MenuExample() {
  return (
    <Menu
      trigger={(props) => (
        <Button {...props} icon={Building2}>
          Most Wanted
        </Button>
      )}
    >
      <MenuLabel>Your companies</MenuLabel>
      <MenuItem href="#forms" current trailing="Owner">
        Most Wanted
      </MenuItem>
      <MenuItem href="#forms" trailing="Admin" description="Set up last week">
        Airia Platform
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Plus} tone="accent" onSelect={() => undefined}>
        Create company
      </MenuItem>
      <MenuItem tone="danger" onSelect={() => undefined} disabled>
        Leave company
      </MenuItem>
    </Menu>
  );
}

export function FormsSection() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [on, setOn] = useState(true);
  return (
    <Section
      id="forms"
      title="Fields, Search, Segmented, Switch, Menu"
      description="Tinted fields that turn white with a blue ring on focus; errors speak under the field."
    >
      <Example
        label="TextField, SelectField, with a hint and an error"
        className="grid gap-4 sm:grid-cols-3"
        wrap={false}
      >
        <TextField label="Company name" placeholder="Most Wanted" hint="You can rename it later." />
        <SelectField label="Role" options={ROLES} defaultValue="member" />
        <TextField label="Email" defaultValue="theo@example" error="Check the form: enter a valid email." />
        <TextField label="Disabled" value="Read only" disabled onChange={() => undefined} />
        <Input size="sm" placeholder="A small input" className="self-end" />
        <Textarea placeholder="A longer note" className="sm:row-span-2" />
      </Example>
      <Example label="SearchBox with the ⌘K hint (focus only; search comes later)" wrap={false}>
        <SearchBox className="max-w-md" />
      </Example>
      <Example label="SegmentedControl and Tabs">
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: 'Grid', icon: LayoutGrid },
            { value: 'list', label: 'List', icon: List },
          ]}
        />
        <Tabs
          label="Example pages"
          size="sm"
          items={[
            { href: '#forms', label: 'Members', current: true, icon: Users },
            { href: '#forms', label: 'Invitations' },
            { href: '#forms', label: 'Keys' },
          ]}
        />
      </Example>
      <Example label="Switch, Menu, CopyButton, ConfirmInline">
        <Switch checked={on} onChange={setOn} label="Show everyone's keys" />
        <Switch checked={false} onChange={() => undefined} label="Disabled" disabled />
        <MenuExample />
        <CopyButton text="019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10" label="Copy id" />
        <ConfirmInline
          label="Revoke"
          question="Revoke “laptop”? Anything using it is refused from now on."
          confirmLabel="Revoke"
          onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
        />
      </Example>
    </Section>
  );
}
