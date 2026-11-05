import { Crop, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { cx } from '../../cx.ts';
import { Button, Spinner } from '../../ui/Button.tsx';
import { CompanyLogo } from '../../ui/CompanyLogo.tsx';
import { ConfirmInline } from '../ConfirmInline.tsx';

const OVERLAY =
  'absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity duration-150';

/** Inside the picker's zone: the pick, else the saved logo, else the initials, else the invitation to add one. */
export function LogoZone({
  name,
  shown,
  waiting,
}: {
  readonly name: string;
  /** The image on show (the pick or the saved logo), if any. */
  readonly shown: string | null;
  readonly waiting: boolean;
}) {
  const mark = waiting ? <Spinner size={22} /> : <ImagePlus size={22} strokeWidth={2} />;
  if (!shown && !name.trim()) {
    return (
      <span className="flex flex-col items-center gap-1">
        {mark}
        <span className="text-2xs font-semibold">Add logo</span>
      </span>
    );
  }
  return (
    <>
      {shown ? (
        <img src={shown} alt="" className="size-full bg-white object-cover" />
      ) : (
        <CompanyLogo name={name} size="xl" />
      )}
      <span className={cx(OVERLAY, waiting ? 'opacity-100' : 'opacity-0 group-hover/drop:opacity-100')}>
        {mark}
      </span>
      {!shown && (
        <span className="absolute right-1.5 bottom-1.5 inline-flex size-6 items-center justify-center rounded-full bg-surface text-ink-2 shadow-raised group-hover/drop:opacity-0">
          <ImagePlus size={13} strokeWidth={2.25} />
        </span>
      )}
    </>
  );
}

/** The buttons beside the zone: choose; or adjust the crop, replace, and remove the pick or the saved logo. */
export function LogoActions({
  picked,
  saved,
  canAdjust,
  off,
  onOpen,
  onAdjust,
  onClear,
  onRemove,
}: {
  readonly picked: boolean;
  readonly saved: boolean;
  readonly canAdjust: boolean;
  readonly off: boolean;
  readonly onOpen: () => void;
  readonly onAdjust: () => void;
  readonly onClear: () => void;
  readonly onRemove: (() => Promise<void>) | undefined;
}) {
  if (!picked && !saved) {
    return (
      <Button size="sm" icon={ImagePlus} disabled={off} onClick={onOpen}>
        Choose a file
      </Button>
    );
  }
  return (
    <>
      {canAdjust && (
        <Button size="sm" icon={Crop} disabled={off} onClick={onAdjust}>
          Adjust
        </Button>
      )}
      <Button size="sm" icon={RefreshCw} disabled={off} onClick={onOpen}>
        Replace
      </Button>
      {picked ? (
        <Button size="sm" tone="quiet" icon={Trash2} disabled={off} onClick={onClear}>
          Remove
        </Button>
      ) : (
        onRemove && (
          <ConfirmInline
            label="Remove"
            question="Remove the logo? The company shows its initials again."
            confirmLabel="Remove logo"
            onConfirm={onRemove}
            disabled={off}
          />
        )
      )}
    </>
  );
}
