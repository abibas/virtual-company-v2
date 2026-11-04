import { SignIn, SignUp } from '@clerk/react';
import { Link } from '../../app/router.tsx';
import { AuthSplit } from '../../components/auth/AuthSplit.tsx';

/** `/sign-in` (and Clerk's steps below it): email code or Google, in the split layout. */
export function SignInPage() {
  return (
    <AuthSplit footer="Invited to a company? Open the link in the invitation email: it signs you up and adds you in one step.">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </AuthSplit>
  );
}

/** `/sign-up` (and Clerk's steps below it). */
export function SignUpPage() {
  return (
    <AuthSplit
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-semibold text-blue hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </AuthSplit>
  );
}
