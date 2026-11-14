import { Link } from '../../app/router.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { turnPath } from '../agents/links.ts';
import { DecisionsList } from '../decisions/DecisionsList.tsx';

/**
 * The decisions agents recorded in a contact's conversations (2026-11-14, docs/subscriptions.md "Contacts";
 * `GET …/decisions?contact=`), newest first, by outcome: whose each is, and a link to its chat at the turn.
 */
export function ContactDecisions({
  companyId,
  companySlug,
  contactId,
  agentName,
}: {
  readonly companyId: string;
  readonly companySlug: string;
  readonly contactId: string;
  /** An agent's name by its id (the contact's conversations'). */
  readonly agentName: (agentId: string) => string | undefined;
}) {
  return (
    <Panel title="Decisions" padding="sm">
      <DecisionsList
        companyId={companyId}
        query={{ contact: contactId }}
        agentName={agentName}
        where={(decision) => (
          <Link
            to={turnPath(companySlug, decision.agentId, decision.chatId, decision.turnId)}
            className="rounded-xs font-semibold text-blue hover:underline"
          >
            In the conversation
          </Link>
        )}
      />
    </Panel>
  );
}
