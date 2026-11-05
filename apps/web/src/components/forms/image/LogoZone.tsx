import { Crop, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { cx } from '../../cx.ts';
import { Avatar } from '../../ui/Avatar.tsx';
import { Button, Spinner } from '../../ui/Button.tsx';
import { CompanyLogo } from '../../ui/CompanyLogo.tsx';
import { ConfirmInline } from '../ConfirmInline.tsx';
import type { CropShape } from './ImageCropper.tsx';

/** What the picker picks: a company's logo (a rounded tile), or a person's photo (round). */
export type PickerKind = 'logo' | 'photo';

interface PickerLook {
  /** The crop frame's mask. */
  readonly shape: CropShape;
  /** The zone's corners. */
  readonly zone: string;
  readonly label: string;
  /** Inside an empty zone. */
  readonly empty: string;
  readonly add: string;
  readonly replace: string;
  readonly crop: string;
  readonly hint: string;
  readonly removeQuestion: string;
  readonly removeConfirm: string;
}

/** How the picker draws and words each kind. */
export const PICKER_KINDS: Readonly<Record<PickerKind, PickerLook>> = {
  logo: {
    shape: 'square',
    zone: 'rounded-2xl',
    label: 'Company logo',
    empty: 'Add logo',
    add: 'Add a logo',
    replace: 'Replace the logo',
    crop: 'Crop the logo',
    hint: 'PNG, JPEG or WebP, up to 10 MB. Click, drop a file, or paste an image; then crop it square.',
    removeQuestion: 'Remove the logo? The company shows its initials again.',
    removeConfirm: 'Remove logo',
  },
  photo: {
    shape: 'round',
    zone: 'rounded-full',
    label: 'Photo',
    empty: 'Add photo',
    add: 'Add a photo',
    replace: 'Replace the photo',
    crop: 'Crop your photo',
    hint: 'Optional. PNG, JPEG or WebP, up to 10 MB. Click, drop a file, or paste an image; then crop it.',
    removeQuestion: 'Remove your photo? Your initials show instead.',
    removeConfirm: 'Remove photo',
  },
};

const OVERLAY =
  'absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity duration-150';

/** Inside the picker's zone: the pick, else the saved image, else the initials, else the invitation to add one. */
export function LogoZone({
  name,
  shown,
  waiting,
  kind = 'logo',
}: {
  readonly name: string;
  /** The image on show (the pick or the saved one), if any. */
  readonly shown: string | null;
  readonly waiting: boolean;
  readonly kind?: PickerKind;
}) {
  const mark = waiting ? <Spinner size={22} /> : <ImagePlus size={22} strokeWidth={2} />;
  if (!shown && !name.trim()) {
    return (
      <span className="flex flex-col items-center gap-1">
        {mark}
        <span className="text-2xs font-semibold">{PICKER_KINDS[kind].empty}</span>
      </span>
    );
  }
  return (
    <>
      {shown ? (
        <img src={shown} alt="" className="size-full bg-white object-cover" />
      ) : kind === 'photo' ? (
        <Avatar name={name} size="2xl" tone="gradient" />
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

/** The buttons beside the zone: choose; or adjust the crop, replace, and remove the pick or the saved image. */
export function LogoActions({
  picked,
  saved,
  canAdjust,
  off,
  onOpen,
  onAdjust,
  onClear,
  onRemove,
  kind = 'logo',
}: {
  readonly kind?: PickerKind;
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
            question={PICKER_KINDS[kind].removeQuestion}
            confirmLabel={PICKER_KINDS[kind].removeConfirm}
            onConfirm={onRemove}
            disabled={off}
          />
        )
      )}
    </>
  );
}
