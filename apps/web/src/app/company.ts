import { createContext, useContext } from 'react';
import type { Me, Membership } from '../api/types.ts';

export interface CompanyView {
  /** The signed-in person's membership in the company on screen (its id, slug, name, role and status). */
  readonly membership: Membership;
  readonly me: Me;
  /** Reads `GET /api/me` again, after a change to the person's companies or role. */
  reload(): Promise<Me>;
}

export const CompanyContext = createContext<CompanyView | null>(null);

/** The company on screen; only inside the company shell (`/c/:slug`). */
export function useCompany(): CompanyView {
  const view = useContext(CompanyContext);
  if (view === null) throw new Error('useCompany() is used outside the company shell');
  return view;
}
