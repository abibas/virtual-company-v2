import { type ReactNode, type Ref, type RefObject, useEffect, useImperativeHandle, useRef } from 'react';
import { cx } from '../../cx.ts';
import { formatBytes } from '../../data/format.ts';
import { ImageCropper, type ImageCropperHandle } from './ImageCropper.tsx';
import { ImageDrop } from './ImageDrop.tsx';
import { LogoActions, LogoZone } from './LogoZone.tsx';
import type { PreparedLogo } from './logo-file.ts';
import { usePicking } from './use-picking.ts';

/** An image to start with (the gallery): cropped by hand, or taken as its centred square at once. */
export interface LogoStart {
  readonly file: File;
  readonly crop?: boolean;
}

export interface LogoPickerProps {
  /** The company's name: its initials stand in until there is a logo. */
  readonly name: string;
  /** The logo saved already (an object URL), if any. */
  readonly src?: string | null | undefined;
  /** The logo picked here and not saved yet. */
  readonly value: PreparedLogo | null;
  readonly onChange: (logo: PreparedLogo | null) => void;
  /** Removes the saved logo (`src`), after a confirmation; without it the saved logo has no Remove button. */
  readonly onRemove?: () => Promise<void>;
  /** The pick is being saved: the zone shows a spinner and the buttons wait. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly pasteAnywhere?: boolean;
  readonly label?: string;
  /** Under the label, until a logo is picked. */
  readonly hint?: ReactNode;
  readonly start?: LogoStart | undefined;
  readonly className?: string;
  readonly ref?: Ref<LogoPickerHandle>;
}

/** For a save that takes the picked logo itself (Create), instead of waiting for `onChange`. */
export interface LogoPickerHandle {
  /**
   * The logo to save: waits for an image still being read and applies an open crop step as it stands, exactly as
   * Done would (`onChange` hears of it too). Null without a pick; rejects with a `LogoError` when the crop is refused.
   */
  settle(): Promise<PreparedLogo | null>;
}

const DEFAULT_HINT =
  'PNG, JPEG or WebP, up to 10 MB. Click, drop a file, or paste an image; then crop it square.';

type Picking = ReturnType<typeof usePicking>;

/** The picker's usual row: the zone, and beside it the label, the facts or the hint, the actions and any error. */
function PickerRow({
  props,
  picking,
  input,
  error,
}: {
  readonly props: LogoPickerProps;
  readonly picking: Picking;
  readonly input: RefObject<HTMLInputElement | null>;
  readonly error: ReactNode;
}) {
  const { name, src, value, onRemove, busy = false, disabled = false, pasteAnywhere = false } = props;
  const { label = 'Company logo', hint = DEFAULT_HINT } = props;
  const shown = value?.url ?? src ?? null;
  const waiting = picking.working || busy;
  return (
    <>
      <ImageDrop
        label={shown ? 'Replace the logo' : 'Add a logo'}
        onFile={(file) => void picking.pick(file)}
        dashed={!shown && !name.trim()}
        pasteAnywhere={pasteAnywhere}
        inputRef={input}
        disabled={disabled || waiting}
        className="size-24 rounded-2xl"
      >
        <LogoZone name={name} shown={shown} waiting={waiting} />
      </ImageDrop>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <p className="text-sm font-semibold text-ink-2">{label}</p>
        <p className="text-xs text-dim">
          {value
            ? `${value.sourceName}: ${value.width}×${value.height}, ${formatBytes(value.blob.size)}, ready to upload.`
            : hint}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <LogoActions
            picked={value !== null}
            saved={Boolean(src)}
            canAdjust={value !== null && picking.kept !== null}
            off={disabled || waiting}
            onOpen={() => input.current?.click()}
            onAdjust={picking.adjust}
            onClear={picking.clear}
            onRemove={onRemove}
          />
        </div>
        {error}
      </div>
    </>
  );
}

/**
 * The company's logo, chosen in place: a rounded square that takes a click, a drop or a paste; the image is then
 * cropped square (moved and zoomed by hand), and the zone shows the result, the saved logo, or the initials of the
 * name. Beside it what to do and the result's facts once it is ready.
 */
export function LogoPicker(props: LogoPickerProps) {
  const { value, onChange, start, className, ref } = props;
  const input = useRef<HTMLInputElement>(null);
  const cropper = useRef<ImageCropperHandle>(null);
  const picking = usePicking(value, onChange);
  const { cropping } = picking;
  useImperativeHandle(ref, () => ({ settle: () => picking.settle(() => cropper.current?.crop()) }));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting image is taken once per `start`.
  useEffect(() => {
    if (start) void picking.pick(start.file, start.crop ?? false);
  }, [start]);
  const error = picking.error && (
    <p role="alert" className="text-xs font-medium text-failed">
      {picking.error}
    </p>
  );
  if (cropping) {
    const { from } = cropping;
    return (
      <div className={cx('flex flex-col gap-3', className)}>
        <ImageCropper
          key={from.url}
          ref={cropper}
          src={from.url}
          width={from.width}
          height={from.height}
          initial={cropping.initial}
          label="Crop the logo"
          className="w-full max-w-sm"
          busy={picking.working}
          onDone={(rect) => void picking.accept(from, rect)}
          onCancel={picking.cancel}
        />
        {error}
      </div>
    );
  }
  return (
    <div className={cx('flex items-start gap-4', className)}>
      <PickerRow props={props} picking={picking} input={input} error={error} />
    </div>
  );
}
