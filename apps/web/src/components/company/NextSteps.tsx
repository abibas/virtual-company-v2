import { Bot, type LucideIcon, Users } from 'lucide-react';
import { IconTile } from '../ui/IconTile.tsx';

const STEPS: readonly { readonly icon: LucideIcon; readonly title: string; readonly line: string }[] = [
  {
    icon: Users,
    title: 'Invite your team',
    line: 'Admins, members and viewers join by email; the link signs them in.',
  },
  {
    icon: Bot,
    title: 'AI agents arrive in S2',
    line: 'Each with a name, a role and a face, reporting to you or to another agent.',
  },
];

/** What comes once the company exists, on the gradient panel of the create-company page. */
export function NextSteps({ className }: { readonly className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold text-white/70">What's next</p>
      <ol className="mt-3 flex flex-col gap-3">
        {STEPS.map((step) => (
          <li key={step.title} className="flex items-center gap-3">
            <IconTile icon={step.icon} tone="inverse" size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">{step.title}</p>
              <p className="text-xs text-white/75">{step.line}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
