import { createContext } from 'react';

/**
 * The open chat's machine (the chat page and the rail's chat give it), for the lines that name it: a turn waiting for
 * the stopped machine (`MachineWait.tsx`), a turn whose runner is away (`Reconnecting.tsx`) and a turn that failed
 * because the agent's folder is not on the machine (`HomeMissing.tsx`).
 */

/** The open chat's machine, and how a turn's wait for it is cancelled (its Stop). */
export interface ChatMachine {
  readonly companyId: string;
  readonly machineId: string;
  readonly cancel: (turnId: string) => Promise<void>;
  /**
   * For admins and owners, while the agent still runs on this machine: its home folder there, and how a failed prompt is
   * sent again once the folder is made.
   */
  readonly home?: { readonly path: string; readonly resend: (prompt: string) => Promise<void> } | undefined;
}

export const ChatMachineContext = createContext<ChatMachine | undefined>(undefined);
