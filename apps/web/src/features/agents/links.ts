import { companyPath } from '../../app/nav.ts';

/** Where the Company structure tabs link to, so the same parts serve the company's routes and the design gallery. */
export interface StructureLinks {
  /** The org chart (the first tab). */
  readonly chart: string;
  /** The list of agents (the Agents tab). */
  readonly list: string;
  /** The people of the company, their roles and invitations (the People tab). */
  readonly people: string;
}

/** Where the agents' pages link to: the Company structure tabs, the hire form, an agent and its chats. */
export interface AgentLinks extends StructureLinks {
  /** The form that hires a new agent. */
  readonly hire: string;
  /** One agent's page. */
  agent(agent: { readonly slug: string; readonly id: string }): string;
  /** The Machines page, where the machines agents run on are enrolled. */
  readonly machines: string;
  /** An agent's chats (S5.1c): `/:slug/chats/:agentId`. */
  chats(agent: { readonly id: string }): string;
}

/** The section of the Company structure page, `/:slug/structure`, with its tabs below it. */
export const STRUCTURE = 'structure';

/** The word of `/agents/new`; an agent with this slug is reached by its id instead. */
const HIRE = 'new';

/** An agent's address under `/agents/`: its slug, or its id when the slug is a word the routes keep. */
export const agentAddress = (agent: { readonly slug: string; readonly id: string }): string =>
  agent.slug === HIRE ? agent.id : agent.slug;

/**
 * The links of a company's agents: the Company structure tabs (`/:slug/structure`, `/agents`, `/people`), the hire
 * form and an agent's page under `/:slug/agents/` (`/new`, `/:agent`), its machines, and an agent's chats.
 */
export function companyAgentLinks(companySlug: string): AgentLinks {
  const base = companyPath(companySlug, 'agents');
  const structure = companyPath(companySlug, STRUCTURE);
  return {
    chart: structure,
    list: `${structure}/agents`,
    people: `${structure}/people`,
    hire: `${base}/${HIRE}`,
    agent: (agent) => `${base}/${agentAddress(agent)}`,
    machines: companyPath(companySlug, 'machines'),
    chats: (agent) => chatsPath(companySlug, agent.id),
  };
}

/** An agent's chats, `/:slug/chats/:agentId`, with one chat open (`?chat=<id>`) when given. */
export function chatsPath(companySlug: string, agentId: string, chatId?: string): string {
  const path = companyPath(companySlug, `chats/${agentId}`);
  return chatId === undefined ? path : `${path}?chat=${encodeURIComponent(chatId)}`;
}

/** True when the address after `/agents/` is the hire form. */
export const isHireAddress = (address: string): boolean => address === HIRE;
