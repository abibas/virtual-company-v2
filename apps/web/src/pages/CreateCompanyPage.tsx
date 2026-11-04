import { PlainShell } from '../app/PlainShell.tsx';
import { Link, navigate } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { CreateCompanyForm } from '../components/company/CreateCompanyForm.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';

/**
 * `/companies/new`: create a company; the person becomes its owner and lands in it. For someone with no company yet
 * this is the onboarding page, which also points to the other way in: an invitation.
 */
export function CreateCompanyPage() {
  const { me, reload } = useSession();
  const first = !me.memberships.some((membership) => membership.status === 'active');
  return (
    <PlainShell>
      <PageHeader title={first ? 'Create your company' : 'Create a company'}>
        <p>
          {first ? `You are signed in as ${me.user.email}. ` : ''}
          Name the company and you become its owner. You can rename it and change its address later.
        </p>
      </PageHeader>
      <CreateCompanyForm
        onCreated={async (company) => {
          await reload();
          navigate(`/c/${company.slug}`);
        }}
        cancel={
          !first && (
            <Link to="/" className="text-sm font-semibold text-dim hover:text-ink">
              Cancel
            </Link>
          )
        }
      />
      {first && (
        <p className="mt-8 border-t border-line pt-5 text-sm text-dim">
          Joining a company that already exists? Ask one of its admins for an invitation. It arrives by email,
          and its link signs you in and adds you to the company.
        </p>
      )}
    </PlainShell>
  );
}
