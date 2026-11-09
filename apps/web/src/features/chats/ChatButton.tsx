import { MessageSquare } from 'lucide-react';
import type { ButtonSize, ButtonTone } from '../../components/ui/Button.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';

/**
 * An agent's Chat button (S5.1c), on its row in the agents table and on its page: to its chats while it has a
 * placement (its chats run on that machine); otherwise disabled, saying why.
 */
export function ChatButton({
  href,
  placed,
  size = 'sm',
  tone = 'secondary',
}: {
  readonly href: string;
  /** The agent has a placement. */
  readonly placed: boolean;
  readonly size?: ButtonSize;
  readonly tone?: ButtonTone;
}) {
  if (placed) {
    return (
      <ButtonLink href={href} size={size} tone={tone} icon={MessageSquare}>
        Chat
      </ButtonLink>
    );
  }
  return (
    <Tooltip label="Choose where it runs first">
      <Button size={size} tone={tone} icon={MessageSquare} disabled>
        Chat
      </Button>
    </Tooltip>
  );
}
