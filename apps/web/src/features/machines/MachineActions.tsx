import { SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import type { Machine } from '../../api/types.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { CommandBox } from './CommandBox.tsx';
import { connectCommand } from './connect-command.ts';
import { TerminalButton } from './terminal/TerminalButton.tsx';

/** The shell command for this machine, its Copy button and where to run it. */
function ConnectPanel({ command, hint }: { readonly command: string; readonly hint: string }) {
  return (
    <section aria-label="Connect" className="flex flex-col gap-3">
      <CommandBox command={command} />
      <p className="text-xs text-dim">{hint}</p>
    </section>
  );
}

/**
 * The card's action row: tools on the left (Connect, and Terminal for owners while the machine is online), Remove for
 * admins on the right, and the open tool's panel under the row (the terminal in its own sheet).
 */
export function MachineActions({
  machine,
  companyId,
  admin,
  owner,
  online,
  onRemove,
}: {
  readonly machine: Machine;
  readonly companyId: string;
  readonly admin: boolean;
  readonly owner: boolean;
  readonly online: boolean;
  readonly onRemove: () => Promise<void>;
}) {
  const connect = connectCommand(machine);
  const [open, setOpen] = useState(false);
  if (!connect && !admin && !owner) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {connect && (
            <Button
              size="sm"
              tone={open ? 'soft' : 'secondary'}
              icon={SquareTerminal}
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
            >
              Connect
            </Button>
          )}
          {owner && <TerminalButton companyId={companyId} machine={machine} online={online} />}
        </div>
        {admin && (
          <ConfirmInline
            label="Remove"
            question={`Remove ${machine.name}? Its runner is refused from then on; its history stays. Enroll it again to bring it back.`}
            confirmLabel="Remove"
            onConfirm={onRemove}
          />
        )}
      </div>
      {connect && open && <ConnectPanel command={connect.command} hint={connect.hint} />}
    </div>
  );
}
