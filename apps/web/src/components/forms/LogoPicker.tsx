import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { formatBytes } from '../data/format.ts';
import { Button, Spinner } from '../ui/Button.tsx';
import { CompanyLogo } from '../ui/CompanyLogo.tsx';
import { ConfirmInline } from './ConfirmInline.tsx';
import { ImageDrop } from './ImageDrop.tsx';
import { LogoError, type PreparedLogo, prepareLogo, releaseLogo } from './logo-file.ts';

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
  readonly className?: string;
}

const DEFAULT_HINT = 'PNG, JPEG or WebP, up to 10 MB. Click, drop a file, or paste an image.';

/** Takes a file through `prepareLogo`, with its progress and its refusal in plain words. */
function usePick(value: PreparedLogo | null, onChange: LogoPickerProps['onChange']) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();
  const pick = useCallback(
    async (file: File) => {
      setPreparing(true);
      setError(undefined);
      try {
        const next = await prepareLogo(file);
        releaseLogo(value);
        onChange(next);
      } catch (failure) {
        setError(failure instanceof LogoError ? failure.message : 'That image could not be read.');
      } finally {
        setPreparing(false);
      }
    },
    [value, onChange],
  );
  const clear = () => {
    releaseLogo(value);
    setError(undefined);
    onChange(null);
  };
  return { preparing, error, pick, clear };
}

const OVERLAY =
  'absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity duration-150';

/** Inside the zone: the pick, else the saved logo, else the initials, else the invitation to add one. */
function Zone({
  name,
  shown,
  waiting,
}: {
  readonly name: string;
  readonly shown: string | null;
  readonly waiting: boolean;
}) {
  if (shown) {
    return (
      <>
        <img src={shown} alt="" className="size-full bg-white object-contain" />
        <span className={cx(OVERLAY, waiting ? 'opacity-100' : 'opacity-0 group-hover/drop:opacity-100')}>
          {waiting ? <Spinner size={22} /> : <ImagePlus size={22} strokeWidth={2} />}
        </span>
      </>
    );
  }
  if (name.trim()) {
    return (
      <>
        <CompanyLogo name={name} size="xl" />
        <span className={cx(OVERLAY, waiting ? 'opacity-100' : 'opacity-0 group-hover/drop:opacity-100')}>
          {waiting ? <Spinner size={22} /> : <ImagePlus size={22} strokeWidth={2} />}
        </span>
        <span className="absolute right-1.5 bottom-1.5 inline-flex size-6 items-center justify-center rounded-full bg-surface text-ink-2 shadow-raised group-hover/drop:opacity-0">
          <ImagePlus size={13} strokeWidth={2.25} />
        </span>
      </>
    );
  }
  return (
    <span className="flex flex-col items-center gap-1">
      {waiting ? <Spinner size={22} /> : <ImagePlus size={22} strokeWidth={2} />}
      <span className="text-2xs font-semibold">Add logo</span>
    </span>
  );
}

/** The buttons beside the zone: choose, replace, remove the pick, or remove the saved logo. */
function Actions({
  picked,
  saved,
  waiting,
  disabled,
  onOpen,
  onClear,
  onRemove,
}: {
  readonly picked: boolean;
  readonly saved: boolean;
  readonly waiting: boolean;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onClear: () => void;
  readonly onRemove: (() => Promise<void>) | undefined;
}) {
  const off = disabled || waiting;
  if (!picked && !saved) {
    return (
      <Button size="sm" icon={ImagePlus} disabled={off} onClick={onOpen}>
        Choose a file
      </Button>
    );
  }
  return (
    <>
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

/**
 * The company's logo, chosen in place: a rounded square that takes a click, a drop or a paste, showing the pick, the
 * saved logo, or the initials of the name; beside it what to do and the file's facts once it is ready.
 */
export function LogoPicker({
  name,
  src,
  value,
  onChange,
  onRemove,
  busy = false,
  disabled = false,
  pasteAnywhere = false,
  label = 'Company logo',
  hint = DEFAULT_HINT,
  className,
}: LogoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const { preparing, error, pick, clear } = usePick(value, onChange);
  const shown = value?.url ?? src ?? null;
  const waiting = preparing || busy;
  return (
    <div className={cx('flex items-start gap-4', className)}>
      <ImageDrop
        label={shown ? 'Replace the logo' : 'Add a logo'}
        onFile={pick}
        dashed={!shown && !name.trim()}
        pasteAnywhere={pasteAnywhere}
        inputRef={input}
        disabled={disabled || waiting}
        className="size-24 rounded-2xl"
      >
        <Zone name={name} shown={shown} waiting={waiting} />
      </ImageDrop>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <p className="text-sm font-semibold text-ink-2">{label}</p>
        <p className="text-xs text-dim">
          {value
            ? `${value.sourceName}: ${value.width}×${value.height}, ${formatBytes(value.blob.size)}, ready to upload.`
            : hint}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Actions
            picked={value !== null}
            saved={Boolean(src)}
            waiting={waiting}
            disabled={disabled}
            onOpen={() => input.current?.click()}
            onClear={clear}
            onRemove={onRemove}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs font-medium text-failed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
