import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { cx } from '../../cx.ts';
import { formatBytes } from '../../data/format.ts';
import type { CropRect } from './crop.ts';
import { ImageCropper } from './ImageCropper.tsx';
import { ImageDrop } from './ImageDrop.tsx';
import { LogoActions, LogoZone } from './LogoZone.tsx';
import {
  encodeLogo,
  LogoError,
  type LogoSource,
  loadLogoSource,
  type PreparedLogo,
  releaseLogo,
  releaseLogoSource,
} from './logo-file.ts';

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
}

const DEFAULT_HINT =
  'PNG, JPEG or WebP, up to 10 MB. Click, drop a file, or paste an image; then crop it square.';

/**
 * A pick is decoded and kept as the source, cropped by hand (or to its centred square at once), encoded, and handed
 * out; the source stays for Adjust until it is replaced, removed or the picker goes away.
 */
function usePicking(value: PreparedLogo | null, onChange: LogoPickerProps['onChange']) {
  const [source, setSource] = useState<LogoSource | null>(null);
  const [cropping, setCropping] = useState<{ readonly initial?: CropRect } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => () => releaseLogoSource(latest.current), []);

  const fail = (failure: unknown) =>
    setError(failure instanceof LogoError ? failure.message : 'That image could not be read.');
  const accept = async (from: LogoSource, crop?: CropRect) => {
    setWorking(true);
    try {
      const next = await encodeLogo(from, crop);
      releaseLogo(value);
      onChange(next);
      setCropping(null);
    } catch (failure) {
      fail(failure);
    } finally {
      setWorking(false);
    }
  };
  const pick = async (file: File, crop = true) => {
    setWorking(true);
    setError(undefined);
    try {
      const next = await loadLogoSource(file);
      releaseLogoSource(source);
      setSource(next);
      if (crop) setCropping({});
      else await accept(next);
    } catch (failure) {
      fail(failure);
    } finally {
      setWorking(false);
    }
  };
  const cancel = () => {
    setCropping(null);
    if (value) return;
    releaseLogoSource(source);
    setSource(null);
  };
  const adjust = () => {
    if (value) setCropping({ initial: value.crop });
  };
  const clear = () => {
    releaseLogoSource(source);
    setSource(null);
    releaseLogo(value);
    setError(undefined);
    onChange(null);
  };
  return { source, cropping, working, error, pick, accept, cancel, adjust, clear };
}

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
            canAdjust={value !== null && picking.source !== null}
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
  const { value, onChange, start, className } = props;
  const input = useRef<HTMLInputElement>(null);
  const picking = usePicking(value, onChange);
  const { source, cropping } = picking;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting image is taken once per `start`.
  useEffect(() => {
    if (start) void picking.pick(start.file, start.crop ?? false);
  }, [start]);
  const error = picking.error && (
    <p role="alert" className="text-xs font-medium text-failed">
      {picking.error}
    </p>
  );
  if (cropping && source) {
    return (
      <div className={cx('flex flex-col gap-3', className)}>
        <ImageCropper
          src={source.url}
          width={source.width}
          height={source.height}
          initial={cropping.initial}
          label="Crop the logo"
          className="w-full max-w-sm"
          busy={picking.working}
          onDone={(rect) => void picking.accept(source, rect)}
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
