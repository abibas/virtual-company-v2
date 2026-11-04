import { AuthSplit } from '../../components/auth/AuthSplit.tsx';
import { TextField } from '../../components/forms/Field.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';

/** The sign-in split with a stand-in where Clerk's form mounts, so the layout can be seen without Clerk. */
export function SignInMock() {
  return (
    <AuthSplit footer="Invited to a company? Open the link in the invitation email: it signs you up and adds you in one step.">
      <Card className="w-full" padding="lg">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold tracking-[-0.02em] text-ink">Sign in</h2>
          <Badge tone="input">Placeholder for Clerk</Badge>
        </div>
        <p className="mt-1 text-sm text-dim">Clerk's own form mounts here, themed from the same tokens.</p>
        <div className="mt-6 flex flex-col gap-4">
          <Button className="w-full" disabled>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <TextField label="Email address" placeholder="you@example.com" disabled />
          <Button tone="primary" className="w-full" disabled>
            Continue
          </Button>
        </div>
      </Card>
    </AuthSplit>
  );
}
