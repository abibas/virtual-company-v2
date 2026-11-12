import { createContext } from 'react';

/**
 * The open chat's machine (the chat page and the rail's chat give it), for the lines that name it: a turn waiting for
 * the stopped machine (`MachineWait.tsx`) and a turn whose runner is away (`Reconnecting.tsx`).
 */

/** The open chat's machine, and how a turn's wait for it is cancelled (its Stop). */
export interface ChatMachine {
  readonly companyId: string;
  readonly machineId: string;
  readonly cancel: (turnId: string) => Promise<void>;
}

export const ChatMachineContext = createContext<ChatMachine | undefined>(undefined);
