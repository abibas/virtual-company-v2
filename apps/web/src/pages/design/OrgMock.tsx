import { useMemo, useState } from 'react';
import { ApiContext } from '../../api/context.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useLocation } from '../../app/router.tsx';
import { AgentProfile } from '../../features/agents/AgentProfile.tsx';
import { AgentsView } from '../../features/agents/AgentsView.tsx';
import { HireAgent } from '../../features/agents/HireAgent.tsx';
import type { AgentLinks } from '../../features/agents/links.ts';
import { chartFlowItems } from '../../features/flows/access.ts';
import { FLOW_PARAM } from '../../features/flows/links.ts';
import { FlowPicker } from '../../features/structure/flow/FlowPicker.tsx';
import { flowAt, flowFocus } from '../../features/structure/flow/flow-focus.ts';
import { StructureView } from '../../features/structure/StructureView.tsx';
import { FLOW_LINKS, SAMPLE_VIEWER } from './flows/FlowsMock.tsx';
import { SAMPLE_FLOW_LIST, SAMPLE_FLOWS } from './flows/flow-sample.ts';
import { MockShell } from './MockShell.tsx';
import { SAMPLE_CHART, sampleAgent, sampleAgentList } from './org-sample.ts';
import { loaded, SAMPLE_COMPANY, SAMPLE_ME, sampleApi } from './records.ts';

const HERE = '/design/org';

/**
 * The Company structure links inside the gallery: the chart and agents tabs and the agents are query strings of this
 * one mock; People is the Members mock.
 */
const LINKS: AgentLinks = {
  chart: HERE,
  list: `${HERE}?view=list`,
  people: '/design/members',
  hire: `${HERE}?agent=new`,
  agent: (agent) => `${HERE}?agent=${agent.slug}`,
  machines: HERE,
  chats: () => HERE,
};

const none = () => undefined;

/**
 * The Company structure page on the sample chart, as the owner sees it, with the list filtered in memory and a sample
 * flow highlighted on the chart (`?flow=vega`).
 */
function AgentsBody({ list }: { readonly list: boolean }) {
  const [status, setStatus] = useState<AgentFilter>('active');
  const chosen = flowAt(SAMPLE_FLOW_LIST.flows, useLocation().search.get(FLOW_PARAM));
  const focus = useMemo(() => {
    const flow = SAMPLE_FLOWS.find((f) => f.id === chosen?.id);
    return flow && flowFocus(flow);
  }, [chosen?.id]);
  return (
    <StructureView
      tab={list ? 'agents' : 'chart'}
      links={LINKS}
      hireHref={LINKS.hire}
      admin
      tools={list ? undefined : <FlowPicker flows={SAMPLE_FLOW_LIST.flows} />}
    >
      <AgentsView
        companyId={SAMPLE_COMPANY.id}
        tab={list ? 'list' : 'chart'}
        links={LINKS}
        chart={loaded(SAMPLE_CHART)}
        agents={loaded(sampleAgentList(status))}
        status={status}
        onStatus={setStatus}
        admin
        myRole="owner"
        meUserId={SAMPLE_ME.id}
        company={{ name: SAMPLE_COMPANY.name, logo: null }}
        flowItem={chartFlowItems(SAMPLE_VIEWER, SAMPLE_FLOW_LIST.flows, FLOW_LINKS)}
        onChanged={none}
        focus={focus}
      />
    </StructureView>
  );
}

/**
 * `/design/org`: the org chart and the list of agents (`?view=list`), the hire form (`?agent=new`) and an agent's
 * page (`?agent=vega`), built from the same parts as the real pages, on sample records and an API client that refuses
 * every change.
 */
export function OrgMock() {
  const { search } = useLocation();
  const [api] = useState(sampleApi);
  const address = search.get('agent');
  const common = {
    companyId: SAMPLE_COMPANY.id,
    chart: loaded(SAMPLE_CHART),
    meUserId: SAMPLE_ME.id,
    links: LINKS,
  };
  return (
    <ApiContext value={api}>
      <MockShell active="org">
        {address === null && <AgentsBody list={search.get('view') === 'list'} />}
        {address === 'new' && <HireAgent {...common} onHired={none} />}
        {address !== null && address !== 'new' && (
          <AgentProfile {...common} agent={sampleAgent(address)} admin onChanged={none} />
        )}
      </MockShell>
    </ApiContext>
  );
}
