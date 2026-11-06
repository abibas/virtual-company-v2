import { companyPath } from '../../app/nav.ts';

/** Where the Agents pages link to, so the same parts serve the company's routes and the design gallery. */
export interface AgentLinks {
  /** The org chart (the Agents page's first tab). */
  readonly chart: string;
  /** The list of agents (its second tab). */
  readonly list: string;
  /** The form that hires a new agent. */
  readonly hire: string;
  /** One agent's page. */
  agent(agent: { readonly slug: string; readonly id: string }): string;
}

/** The word of `/agents/new`; an agent with this slug is reached by its id instead. */
const HIRE = 'new';

/** An agent's address under `/agents/`: its slug, or its id when the slug is a word the routes keep. */
export const agentAddress = (agent: { readonly slug: string; readonly id: string }): string =>
  agent.slug === HIRE ? agent.id : agent.slug;

/** The links of a company's Agents pages: `/:slug/agents`, `?view=list`, `/new` and `/:agent`. */
export function companyAgentLinks(companySlug: string): AgentLinks {
  const base = companyPath(companySlug, 'agents');
  return {
    chart: base,
    list: `${base}?view=list`,
    hire: `${base}/${HIRE}`,
    agent: (agent) => `${base}/${agentAddress(agent)}`,
  };
}

/** True when the address after `/agents/` is the hire form. */
export const isHireAddress = (address: string): boolean => address === HIRE;
