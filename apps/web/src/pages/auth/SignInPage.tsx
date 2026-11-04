import { SignIn, SignUp } from '@clerk/react';
import { Link } from '../../app/router.tsx';
import { AuthLayout } from '../../components/AuthLayout.tsx';

/** `/sign-in` (and Clerk's steps below it): email code or Google. */
export function SignInPage() {
  return (
    <AuthLayout
      footer={
        <>
          Invited to a company? Open the link in the invitation email: it signs you up and adds you in one
          step.
        </>
      }
    >
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </AuthLayout>
  );
}

/** `/sign-up` (and Clerk's steps below it). */
export function SignUpPage() {
  return (
    <AuthLayout
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="text-amber underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </AuthLayout>
  );
}
