import { companyPath } from '../../app/nav.ts';

/** A team's page's tabs: its board and its flow. */
export type TeamTab = 'board' | 'flow';

/**
 * Where the flows' pages link to, so the same parts serve the company's routes and the design gallery: Company
 * structure, the flows, a team's page (by its Lead's address) and its tab, and a task.
 */
export interface FlowLinks {
  readonly structure: string;
  readonly flows: string;
  /** A team's page: its board, or its flow (`edit`: with the editor open). */
  team(lead: string, tab?: TeamTab, edit?: boolean): string;
  /** A task's page, by its key (`T-12`). */
  task(key: string): string;
}

/** A Lead's address under `/flows/`: an agent's slug, a person's principal id. */
export const leadAddress = (lead: {
  readonly principalId: string;
  readonly slug?: string | null | undefined;
}): string => lead.slug ?? lead.principalId;

/** The query parameter of the org chart that highlights a flow, by its Lead's address (`/structure?flow=<lead>`). */
export const FLOW_PARAM = 'flow';

/** The org chart with the flow of the Lead at `lead` highlighted. */
export const chartWithFlow = (links: FlowLinks, lead: string): string =>
  `${links.structure}?${FLOW_PARAM}=${encodeURIComponent(lead)}`;

/** The word after a team's address that opens its Flow tab (`/flows/<lead>/flow`). */
export const FLOW_TAB = 'flow';

/** The links of a company's flows: `/:slug/flows`, `/flows/<lead>`, `/flows/<lead>/flow` and `/tasks/<key>`. */
export function companyFlowLinks(slug: string): FlowLinks {
  const flows = companyPath(slug, 'flows');
  return {
    structure: companyPath(slug, 'structure'),
    flows,
    team: (lead, tab = 'board', edit = false) => {
      const base = `${flows}/${encodeURIComponent(lead)}`;
      if (tab === 'board') return base;
      return `${base}/${FLOW_TAB}${edit ? '?edit=1' : ''}`;
    },
    task: (key) => companyPath(slug, `tasks/${encodeURIComponent(key)}`),
  };
}
