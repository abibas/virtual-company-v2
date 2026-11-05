import { UserButton } from '@clerk/react';
import { companyPath } from '../app/nav.ts';
import { Link, navigate } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { CreateCompanyScreen } from '../components/company/CreateCompanyScreen.tsx';
import { UserWell } from '../components/layout/TopBar.tsx';

/**
 * `/companies/new`: create a company; the person becomes its owner and lands in it. For someone with no company yet
 * this is the onboarding page, which also points to the other way in: an invitation.
 */
export function CreateCompanyPage() {
  const { me, reload } = useSession();
  const first = !me.memberships.some((membership) => membership.status === 'active');
  return (
    <CreateCompanyScreen
      email={me.user.email}
      imageUrl={me.user.imageUrl}
      first={first}
      corner={
        <UserWell>
          <UserButton />
        </UserWell>
      }
      onCreated={async (company) => {
        await reload();
        navigate(companyPath(company.slug));
      }}
      cancel={
        !first && (
          <Link to="/" className="text-sm font-semibold text-dim hover:text-ink">
            Cancel
          </Link>
        )
      }
    />
  );
}
