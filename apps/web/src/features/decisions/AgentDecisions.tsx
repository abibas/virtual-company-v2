import { Link } from '../../app/router.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { turnPath } from '../agents/links.ts';
import { DecisionsList } from './DecisionsList.tsx';

/** The decisions an agent recorded (2026-11-14), on its page under its fields: each links to its chat and turn. */
export function AgentDecisions({
  companyId,
  companySlug,
  agentId,
}: {
  readonly companyId: string;
  readonly companySlug: string;
  readonly agentId: string;
}) {
  return (
    <Panel title="Decisions">
      <DecisionsList
        companyId={companyId}
        query={{ agent: agentId }}
        where={(decision) => (
          <Link
            to={turnPath(companySlug, agentId, decision.chatId, decision.turnId)}
            className="rounded-xs font-semibold text-blue hover:underline"
          >
            In its chat
          </Link>
        )}
      />
    </Panel>
  );
}
