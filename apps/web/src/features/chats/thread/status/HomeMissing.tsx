import { FolderPlus, SendHorizontal } from 'lucide-react';
import { useContext, useMemo, useState } from 'react';
import { useApi } from '../../../../api/context.ts';
import { friendlyMessage } from '../../../../api/errors.ts';
import { machineCalls } from '../../../../api/machines.ts';
import { Button } from '../../../../components/ui/Button.tsx';
import { ChatMachineContext } from './chat-machine.ts';

/**
 * Under a turn that failed because the agent's folder is not on the machine (`home_missing`, docs/harness.md): for admins
 * and owners, **Create folder** makes the agent's home folder with its parents through the runner (`POST …/folders`,
 * `parents`), then **Send again** sends the turn's prompt once more. Nothing without the chat's machine context's
 * `home` (a reader, a closed chat, an agent moved elsewhere).
 */
export function HomeMissingActions({ prompt }: { readonly prompt: string }) {
  const at = useContext(ChatMachineContext);
  const api = useApi();
  const calls = useMemo(() => at && machineCalls(api, at.companyId), [api, at]);
  const [step, setStep] = useState<'create' | 'creating' | 'send' | 'sending'>('create');
  const [error, setError] = useState<string>();
  const home = at?.home;
  if (at === undefined || home === undefined || calls === undefined) return null;
  const run = async (busy: typeof step, action: () => Promise<unknown>, next: typeof step) => {
    setStep(busy);
    setError(undefined);
    try {
      await action();
      setStep(next);
    } catch (failure) {
      setError(friendlyMessage(failure));
      setStep(busy === 'creating' ? 'create' : 'send');
    }
  };
  const sending = step === 'send' || step === 'sending';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {sending ? (
        <Button
          size="sm"
          tone="primary"
          icon={SendHorizontal}
          busy={step === 'sending'}
          onClick={() => void run('sending', () => home.resend(prompt), 'send')}
        >
          Send again
        </Button>
      ) : (
        <Button
          size="sm"
          icon={FolderPlus}
          busy={step === 'creating'}
          onClick={() => void run('creating', () => calls.makeFolder(at.machineId, home.path, true), 'send')}
        >
          Create folder
        </Button>
      )}
      <span className="min-w-0 font-mono text-xs break-all text-dim">{home.path}</span>
      {error && (
        <span role="alert" className="w-full text-xs text-failed">
          {error}
        </span>
      )}
    </div>
  );
}
