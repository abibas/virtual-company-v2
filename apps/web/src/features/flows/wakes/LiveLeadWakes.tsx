import { type Flow, type FlowCalls, useLeadWakes } from '../../../api/flows.ts';
import { companyFlowLinks, leadAddress } from '../links.ts';
import { LeadWakesSection } from './LeadWakes.tsx';
import { settingsOf } from './words.ts';

/**
 * The "Lead wakes up on" section, live (S6c): the flow's wake-ups read once (`GET …/lead-wakes`) and saved with a PUT,
 * then read again; Team chat links to the team's room. Shown by the team's page to those who lead the team when
 * the Lead is an agent.
 */
export function LiveLeadWakes({
  companyId,
  slug,
  flow,
  calls,
}: {
  readonly companyId: string;
  readonly slug: string;
  readonly flow: Flow;
  readonly calls: FlowCalls;
}) {
  const wakes = useLeadWakes(companyId, flow.id);
  if (wakes.data === undefined || !wakes.data.leadIsAgent) return null;
  return (
    <LeadWakesSection
      key={JSON.stringify(settingsOf(wakes.data))}
      wakes={wakes.data}
      leadName={flow.lead.name}
      chatHref={companyFlowLinks(slug).team(leadAddress(flow.lead), 'chat')}
      onSave={async (settings) => {
        await calls.putLeadWakes(flow.id, settings);
        wakes.reload();
      }}
    />
  );
}
