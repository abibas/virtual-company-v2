import { companyPath } from '../app/nav.ts';
import { Redirect } from '../app/router.tsx';
import { chooseCompany, useSession } from '../app/session.tsx';

/** `/`: the company last opened in this browser, else the first one, else creating one. */
export function LandingPage() {
  const { me } = useSession();
  const company = chooseCompany(me);
  return <Redirect to={company ? companyPath(company.slug) : '/companies/new'} />;
}
