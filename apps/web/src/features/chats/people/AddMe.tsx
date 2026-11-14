import { UserPlus } from 'lucide-react';
import { Button } from '../../../components/ui/Button.tsx';
import { useAction } from '../use-action.ts';
import type { ChatPeople } from './use-chat-people.ts';

/** The owner view's Add me (2026-11-14): puts the owner in the chat (audited), and the chat opens to them in full. */
export function AddMe({ people }: { readonly people: ChatPeople }) {
  const { busy, error, run } = useAction();
  const me = people.reader.principalId;
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-failed">{error}</span>}
      <Button
        size="sm"
        tone="primary"
        icon={UserPlus}
        busy={busy}
        disabled={me === undefined}
        onClick={() => void run(() => people.actions.add([me as string]))}
      >
        Add me
      </Button>
    </span>
  );
}
