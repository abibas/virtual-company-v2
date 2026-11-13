import { isToolKind } from '@mwc/shared/credentials';
import { Plus, Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { subscriptionCalls } from '../../api/subscriptions.ts';
import type { Subscription } from '../../api/types.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { useHighlight } from '../subscriptions/sign-in.ts';
import { type AddTool, AddToolSheet, useAddTool } from './AddToolSheet.tsx';
import { ToolCard } from './ToolCard.tsx';
import { type ToolSignIn, toolSite } from './tools.ts';

/** The sign-in a card's Sign in again opens: GitHub's device sign-in, or the form for a new token. */
function signInAgain(adding: AddTool, tool: ToolSignIn): void {
  if (tool.kind === 'github_oauth') adding.signInWithGitHub(tool.id);
  else if (tool.kind === 'github_token') adding.form('github_token', { credentialId: tool.id });
  else if (tool.kind === 'slack_bot_token' || tool.kind === 'slack_user_token')
    adding.form('slack', { credentialId: tool.id });
  else {
    const renew = { credentialId: tool.id, site: toolSite(tool), email: tool.accountEmail ?? undefined };
    adding.form('atlassian_api_token', renew);
  }
}

/**
 * The Subscriptions page's Tools part (S7.1a): the person's GitHub, Atlassian and Slack sign-ins, one card each, and Add a
 * tool in a sheet beside the page. `onChanged` reads the subscriptions again.
 */
export function ToolsSection({
  subscriptions,
  onChanged,
}: {
  readonly subscriptions: readonly Subscription[];
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const calls = useMemo(() => subscriptionCalls(api), [api]);
  const [highlight, setHighlight] = useHighlight();
  const done = (credentialId: string) => {
    onChanged();
    setHighlight(credentialId);
  };
  const adding = useAddTool(done);
  const tools = subscriptions.filter((s): s is ToolSignIn => isToolKind(s.kind));
  return (
    <section aria-labelledby="tools-heading" className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="tools-heading" className="text-md font-bold text-ink">
          Tools
        </h2>
        <Button size="sm" tone="soft" icon={Plus} onClick={adding.choose}>
          Add a tool
        </Button>
      </div>
      {tools.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wrench}
            tone="blue"
            size="sm"
            title="No GitHub, Atlassian or Slack sign-ins yet"
            action={
              <Button tone="primary" icon={Plus} onClick={adding.choose}>
                Add a tool
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              rename={(label) => calls.rename(tool.id, label).then(onChanged)}
              remove={() => calls.remove(tool.id).then(onChanged)}
              check={() => calls.checkTool(tool.id).then(onChanged)}
              signInAgain={() => signInAgain(adding, tool)}
              highlighted={tool.id === highlight}
            />
          ))}
        </div>
      )}
      <AddToolSheet adding={adding} onAdded={(signIn) => done(signIn.id)} />
    </section>
  );
}
