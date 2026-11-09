import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { type MachineCalls, machineCalls, useVisibleInterval } from '../../api/machines.ts';
import type { EnrollmentToken, Machine } from '../../api/types.ts';
import type { NewMachineKind } from './install-commands.ts';

/** How often the open sheet looks for the new machine. */
const WATCH_EVERY_MS = 3000;

export interface AddMachine {
  readonly open: boolean;
  /** The kind chosen, once a token is asked for. */
  readonly kind: NewMachineKind | undefined;
  readonly token: EnrollmentToken | undefined;
  readonly busy: boolean;
  readonly error: unknown;
  /** The machine that enrolled while the sheet was open. */
  readonly connected: Machine | undefined;
  /** Opens the sheet at its choices. */
  choose(): void;
  /** Chooses a kind: a token and its command at once, or for a container its form first (`mint` then). */
  pick(kind: NewMachineKind): void;
  /** Makes a one-time token for the chosen kind (again, when one expired or failed). */
  mint(): void;
  back(): void;
  close(): void;
}

/** Looks at the machines every 3 seconds while `known` is set, until one not in it appears. */
function useWatchForNew(
  calls: MachineCalls,
  known: ReadonlySet<string> | undefined,
  onFound: (machine: Machine) => void,
) {
  useVisibleInterval(
    () => {
      void calls.list().then(
        ({ machines }) => {
          const fresh = machines.find((machine) => !known?.has(machine.id));
          if (fresh) onFound(fresh);
        },
        () => undefined,
      );
    },
    WATCH_EVERY_MS,
    known !== undefined,
  );
}

/** A one-time token and the machines known when it was made (to spot the new one), with its busy and error states. */
function useOneTimeToken(calls: MachineCalls) {
  const [token, setToken] = useState<EnrollmentToken>();
  const [known, setKnown] = useState<ReadonlySet<string>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const clear = () => {
    setToken(undefined);
    setKnown(undefined);
    setError(undefined);
  };
  const mint = async () => {
    clear();
    setBusy(true);
    try {
      const [list, created] = await Promise.all([calls.list(), calls.createToken()]);
      setKnown(new Set(list.machines.map((machine) => machine.id)));
      setToken(created);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return { token, known, busy, error, clear, mint };
}

/**
 * The add sheet's state: a one-time token for the chosen kind (for a container once its form is filled), then a look
 * at the machines every 3 seconds while the sheet is open, until one that was not there before appears (`onConnected`
 * hears of it).
 */
export function useAddMachine(companyId: string, onConnected: (machine: Machine) => void): AddMachine {
  const calls = machineCalls(useApi(), companyId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NewMachineKind>();
  const [connected, setConnected] = useState<Machine>();
  const { token, known, busy, error, ...minting } = useOneTimeToken(calls);
  const mint = () => {
    setConnected(undefined);
    void minting.mint();
  };
  const reset = () => {
    setKind(undefined);
    setConnected(undefined);
    minting.clear();
  };
  useWatchForNew(calls, open && connected === undefined ? known : undefined, (fresh) => {
    setConnected(fresh);
    onConnected(fresh);
  });
  return {
    open,
    kind,
    token,
    busy,
    error,
    connected,
    choose: () => {
      reset();
      setOpen(true);
    },
    pick: (next) => {
      reset();
      setKind(next);
      // A container's limits are chosen first; its token comes with "Create command".
      if (next !== 'container') mint();
    },
    mint,
    back: reset,
    close: () => {
      setOpen(false);
      reset();
    },
  };
}
