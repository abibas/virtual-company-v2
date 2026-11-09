import { useState } from 'react';
import { useMachineLogo } from '../../api/machine-logo.ts';
import type { MachineKind } from '../../api/types.ts';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { MachineLogoSheet } from './MachineLogoSheet.tsx';
import { kindIcon } from './machine-text.ts';

/** What a machine's mark needs: which machine, its logo's version (null without one), its kind and whether it is up. */
export interface MachineMark {
  readonly companyId: string;
  readonly machineId: string;
  readonly name: string;
  readonly kind: MachineKind;
  readonly online: boolean;
  readonly logoVersion: string | null | undefined;
}

/**
 * A machine's face wherever it appears, as `CompanyLogo` is a company's: its logo on a white tile, else its kind's
 * icon on a tinted tile (blue while it is online).
 */
export function MachineLogo({ mark }: { readonly mark: MachineMark }) {
  const src = useMachineLogo(mark.companyId, mark.machineId, mark.logoVersion);
  if (!src) {
    return <IconTile icon={kindIcon(mark.kind)} tone={mark.online ? 'blue' : 'neutral'} />;
  }
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-10 shrink-0 overflow-hidden rounded-lg bg-white"
    >
      <img src={src} alt="" className="size-full object-cover" />
      <span className="absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset" />
    </span>
  );
}

/** The machine's mark for admins and owners: a click opens the logo sheet (upload, crop, Remove). */
export function EditableMachineLogo({
  mark,
  onChanged,
}: {
  readonly mark: MachineMark;
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change the logo of ${mark.name}`}
        title="Change the logo"
        className="shrink-0 rounded-lg transition-shadow hover:ring-2 hover:ring-blue/40 focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none"
      >
        <MachineLogo mark={mark} />
      </button>
      <MachineLogoSheet mark={mark} open={open} onClose={() => setOpen(false)} onChanged={onChanged} />
    </>
  );
}
