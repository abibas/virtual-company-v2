import { useState } from 'react';
import { ApiContext } from '../../api/context.ts';
import { CreateKeyForm } from '../../components/api-keys/CreateKeyForm.tsx';
import { KeysPanel } from '../../components/api-keys/KeysPanel.tsx';
import { LoginCommand } from '../../components/api-keys/LoginCommand.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { InvitationsPanel } from '../../components/members/InvitationsPanel.tsx';
import { InvitePanel } from '../../components/members/InviteForm.tsx';
import { PeoplePanel } from '../../components/members/PeoplePanel.tsx';
import { CompanyDetailsForm } from '../../components/settings/CompanyDetailsForm.tsx';
import { DeleteCompany } from '../../components/settings/DeleteCompany.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { type MockPage, MockShell } from './MockShell.tsx';
import {
  loaded,
  SAMPLE_COMPANY,
  SAMPLE_INVITATIONS,
  SAMPLE_KEYS,
  SAMPLE_KEYS_EVERYONE,
  SAMPLE_ME,
  SAMPLE_MEMBERS,
  sampleApi,
} from './records.ts';

const none = () => undefined;

/** The Members page's parts with sample people, as an owner sees them. */
function MembersBody() {
  return (
    <>
      <PageHeader title="Members">
        <p>Invite people, set their roles and remove them. Changes take effect at once.</p>
      </PageHeader>
      <div className="grid gap-4 md:gap-5">
        <InvitePanel companyId={SAMPLE_COMPANY.id} myRole="owner" onInvited={none} />
        <PeoplePanel
          companyId={SAMPLE_COMPANY.id}
          companyName={SAMPLE_COMPANY.name}
          members={loaded({ members: SAMPLE_MEMBERS })}
          myRole="owner"
          myUserId={SAMPLE_ME.id}
          admin
          onNotice={none}
          onSynced={none}
          onChanged={none}
          onLeft={none}
        />
        <InvitationsPanel
          companyId={SAMPLE_COMPANY.id}
          invitations={loaded({ invitations: SAMPLE_INVITATIONS })}
          myRole="owner"
          onChanged={none}
        />
      </div>
    </>
  );
}

/** The API keys page's parts with sample keys; the switch shows everyone's. */
function KeysBody() {
  const [everyone, setEveryone] = useState(false);
  return (
    <>
      <PageHeader title="API keys">
        <p>
          A personal key lets the mwc CLI, or your own Claude Code, act as you in Most Wanted, and nowhere
          else.
        </p>
      </PageHeader>
      <div className="grid gap-4 md:gap-5">
        <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
          <Panel
            title="Create a key"
            description="Give it a name you will recognise, such as the machine it is for."
          >
            <CreateKeyForm companyId={SAMPLE_COMPANY.id} onCreated={none} />
          </Panel>
          <Panel title="Sign in the CLI" description="Save a key on your machine with this command.">
            <LoginCommand apiUrl="http://localhost:9950" companyId={SAMPLE_COMPANY.id} />
          </Panel>
        </div>
        <KeysPanel
          companyId={SAMPLE_COMPANY.id}
          keys={loaded({ apiKeys: everyone ? SAMPLE_KEYS_EVERYONE : SAMPLE_KEYS })}
          myUserId={SAMPLE_ME.id}
          admin
          everyone={everyone}
          onEveryone={setEveryone}
        />
      </div>
    </>
  );
}

/** The Settings page's parts, as an owner sees them. */
function SettingsBody() {
  return (
    <>
      <PageHeader title="Settings">
        <p>The company’s name and address.</p>
      </PageHeader>
      <div className="grid gap-4 md:gap-5">
        <Panel
          title="Name and address"
          description="The address is the company's place in every link: /c/<address>."
        >
          <CompanyDetailsForm
            companyId={SAMPLE_COMPANY.id}
            name={SAMPLE_COMPANY.name}
            slug={SAMPLE_COMPANY.slug}
            onSaved={() => Promise.resolve()}
          />
        </Panel>
        <DeleteCompany companyId={SAMPLE_COMPANY.id} name={SAMPLE_COMPANY.name} onDeleted={none} />
      </div>
    </>
  );
}

const BODIES = { members: MembersBody, 'api-keys': KeysBody, settings: SettingsBody } as const;

/**
 * The Members, API keys and Settings pages in the shell, built from the same parts as the real pages, on sample
 * records and an API client that refuses every change.
 */
export function PagesMock({ page }: { readonly page: Exclude<MockPage, 'dashboard'> }) {
  const [api] = useState(sampleApi);
  const Body = BODIES[page];
  return (
    <ApiContext value={api}>
      <MockShell active={page}>
        <Body />
      </MockShell>
    </ApiContext>
  );
}
