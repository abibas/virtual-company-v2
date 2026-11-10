import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from '../../../app/router.tsx';
import { machineCardId, machineToolsId } from '../tools/tools-text.ts';

/**
 * Which machine cards this viewer opened on the Machines page, per company, kept in this browser (best effort), and the
 * deep link that opens one (`?machine=<id>`, `#tools` for its Tools part).
 */

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

/** The open machines (all folded at first), a toggle for one of them, and opening one. */
export function useOpenMachines(companyId: string) {
  const [open, setOpen] = useState(() => read(companyId));
  const change = useCallback(
    (machineId: string, to: (open: boolean) => boolean) =>
      setOpen((was) => {
        const next = new Set(was);
        if (to(next.has(machineId))) next.add(machineId);
        else next.delete(machineId);
        write(companyId, next);
        return next;
      }),
    [companyId],
  );
  return {
    isOpen: (machineId: string) => open.has(machineId),
    toggle: (machineId: string) => change(machineId, (was) => !was),
    open: (machineId: string) => change(machineId, () => true),
  };
}

/**
 * `/:slug/machines?machine=<id>` opens that machine's card once the machines are loaded and scrolls to it, or to its
 * Tools part with `#tools` (the chat and the agent form link there); once per address.
 */
export function useMachineLink(
  machineIds: readonly string[] | undefined,
  folds: Pick<ReturnType<typeof useOpenMachines>, 'isOpen' | 'open'>,
): void {
  const { search, href } = useLocation();
  const wanted = search.get('machine');
  const done = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (wanted === null || !machineIds?.includes(wanted) || done.current === href) return;
    if (!folds.isOpen(wanted)) {
      folds.open(wanted);
      return;
    }
    done.current = href;
    const id = href.endsWith('#tools') ? machineToolsId(wanted) : machineCardId(wanted);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
