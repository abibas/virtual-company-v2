import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { usePublicConfig } from '../../api/config.ts';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { CreatedApiKey } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { CompanyFacts } from '../../features/api-keys/CompanyFacts.tsx';
import { CreateKeyForm } from '../../features/api-keys/CreateKeyForm.tsx';
import { KeysPanel } from '../../features/api-keys/KeysPanel.tsx';
import { LoginCommand } from '../../features/api-keys/LoginCommand.tsx';
import { NewKeySecret } from '../../features/api-keys/NewKeySecret.tsx';

/**
 * `/:slug/api-keys`: personal API keys for the `mwc` CLI and your own Claude Code. Make one (its secret shown once,
 * kept only in this page's memory), see and revoke yours; admins and owners can see and revoke everyone's. Below them
 * the company's facts the CLI and Claude Code need.
 */
export function ApiKeysPage() {
  const api = useApi();
  const config = usePublicConfig();
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const admin = roleAtLeast(membership.role, 'admin');
  const [everyone, setEveryone] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey>();
  const showAll = admin && everyone;
  const keys = useLoad(`keys:${companyId}:${showAll}`, () =>
    call(
      api.api.companies[':companyId']['api-keys'].$get({
        param: { companyId },
        query: showAll ? { all: '1' } : {},
      }),
    ),
  );

  return (
    <>
      <PageHeader title="API keys">
        <p>
          A personal key lets the <code className="font-mono text-xs">mwc</code> CLI, or your own Claude Code,
          act as you in {membership.name}, and nowhere else.
        </p>
      </PageHeader>
      <div className="grid gap-4 md:gap-5">
        <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
          {created ? (
            <NewKeySecret apiKey={created} onDone={() => setCreated(undefined)} />
          ) : (
            <Panel
              title="Create a key"
              description="Give it a name you will recognise, such as the machine it is for."
            >
              <CreateKeyForm
                companyId={companyId}
                onCreated={(key) => {
                  setCreated(key);
                  keys.reload();
                }}
              />
            </Panel>
          )}
          <Panel title="Sign in the CLI" description="Save a key on your machine with this command.">
            <LoginCommand apiUrl={config.apiUrl} companyId={companyId} />
          </Panel>
        </div>
        <KeysPanel
          companyId={companyId}
          keys={keys}
          myUserId={me.user.id}
          admin={admin}
          everyone={showAll}
          onEveryone={setEveryone}
        />
        <CompanyFacts user={me.user} slug={membership.slug} companyId={companyId} />
      </div>
    </>
  );
}
