import { createContext, useContext } from 'react';
import type { AgentList, Me, Membership } from '../api/types.ts';
import type { Loaded } from '../api/use-load.ts';

export interface CompanyView {
  /** The signed-in person's membership in the company on screen (its id, slug, name, role and status). */
  readonly membership: Membership;
  readonly me: Me;
  /** Reads `GET /api/me` again, after a change to the person's companies or role. */
  reload(): Promise<Me>;
  /**
   * The company's team, its active and paused agents (`GET /agents`): the quick-create dock's faces and the
   * Overview's card. A page that hires, archives or changes an agent reloads it.
   */
  readonly agents: Loaded<AgentList>;
}

export const CompanyContext = createContext<CompanyView | null>(null);

/** The company on screen; only inside the company shell (`/c/:slug`). */
export function useCompany(): CompanyView {
  const view = useContext(CompanyContext);
  if (view === null) throw new Error('useCompany() is used outside the company shell');
  return view;
}
