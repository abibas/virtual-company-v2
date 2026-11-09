import { SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import type { Machine } from '../../api/types.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { CommandBox } from './CommandBox.tsx';
import { connectCommand } from './connect-command.ts';

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
 * The card's action row: tools on the left (Connect; more go next to it), Remove for admins on the right,
 * and the open tool's panel under the row.
 */
export function MachineActions({
  machine,
  admin,
  onRemove,
}: {
  readonly machine: Machine;
  readonly admin: boolean;
  readonly onRemove: () => Promise<void>;
}) {
  const connect = connectCommand(machine);
  const [open, setOpen] = useState(false);
  if (!connect && !admin) return null;
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
