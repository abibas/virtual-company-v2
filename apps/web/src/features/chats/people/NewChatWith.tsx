import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOrgChart } from '../../../api/org.ts';
import { useCompany } from '../../../app/company.ts';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { useAction } from '../use-action.ts';
import { MemberPicker } from './MemberPicker.tsx';
import { memberChoices, readerPrincipal } from './people-model.ts';

/**
 * New chat's With (2026-11-14, docs/harness.md "Who is in a chat"): beside New chat, a button that opens the company's
 * members to begin a chat with several people; the chat is theirs and yours, and nobody else's.
 */
export function NewChatWith({
  disabled,
  onStart,
}: {
  readonly disabled: boolean;
  readonly onStart: (people: readonly string[]) => Promise<void>;
}) {
  const { membership, me } = useCompany();
  const [open, setOpen] = useState(false);
  const chart = useOrgChart(membership.companyId);
  const { busy, error, run } = useAction();
  const choices = useMemo(() => {
    const nodes = chart.data?.nodes ?? [];
    const self = readerPrincipal(nodes, me.user.id);
    return memberChoices(nodes, new Set(self === undefined ? [] : [self]));
  }, [chart.data, me.user.id]);
  const start = (people: readonly string[]) =>
    void run(async () => {
      await onStart(people);
      setOpen(false);
    });
  return (
    <>
      <IconButton
        label="New chat with people"
        icon={Users}
        size="sm"
        tone="soft"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New chat with people"
        description="Only the people you pick and you will see this chat."
      >
        {error && (
          <p role="alert" className="mb-3 text-sm font-medium text-failed">
            {error}
          </p>
        )}
        {chart.data === undefined ? (
          <p className="text-sm text-dim">Loading the members…</p>
        ) : (
          <MemberPicker choices={choices} action="Start chat" busy={busy} onPick={start} />
        )}
      </Sheet>
    </>
  );
}
