import { useCallback, useState } from 'react';

/** Which machine cards this viewer opened on the Machines page, per company, kept in this browser (best effort). */

const key = (companyId: string) => `mwc.machines.open.${companyId}`;

function read(companyId: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(key(companyId));
    const ids: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(companyId: string, open: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key(companyId), JSON.stringify([...open]));
  } catch {
    // A private window or blocked storage: the folds just are not remembered.
  }
}

/** The open machines (all folded at first) and a toggle for one of them. */
export function useOpenMachines(companyId: string) {
  const [open, setOpen] = useState(() => read(companyId));
  const toggle = useCallback(
    (machineId: string) =>
      setOpen((was) => {
        const next = new Set(was);
        if (!next.delete(machineId)) next.add(machineId);
        write(companyId, next);
        return next;
      }),
    [companyId],
  );
  return { isOpen: (machineId: string) => open.has(machineId), toggle };
}
