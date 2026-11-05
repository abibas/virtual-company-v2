import { useEffect, useRef, useState } from 'react';
import { type CropRect, coverCrop } from './crop.ts';
import {
  encodeLogo,
  LogoError,
  type LogoSource,
  loadLogoSource,
  type PreparedLogo,
  releaseLogo,
  releaseLogoSource,
} from './logo-file.ts';

/** The crop step: the image being cropped, and the crop it starts from (adjusting an earlier one). */
export interface Cropping {
  readonly from: LogoSource;
  readonly initial?: CropRect | undefined;
}

/** What a save reads after an `await`: kept beside the state, so it never sees a render's stale copy. */
interface Live {
  value: PreparedLogo | null;
  /** The source of `value`, for Adjust; kept until it is replaced, removed or the picker goes away. */
  kept: LogoSource | null;
  cropping: Cropping | null;
  /** The pick or crop still being decoded or encoded. */
  task: Promise<unknown> | null;
}

const failureText = (failure: unknown) =>
  failure instanceof LogoError ? failure.message : 'That image could not be read.';

/**
 * A pick is decoded and cropped by hand (or to its centred square at once), encoded, and handed out. The image being
 * cropped stays apart from the source of the logo already picked, so cancelling a replacement keeps the logo and its
 * Adjust as they were. `settle` lets a save apply an open crop step as it stands, exactly as Done would.
 */
export function usePicking(value: PreparedLogo | null, onChange: (logo: PreparedLogo | null) => void) {
  const [kept, setKeptState] = useState<LogoSource | null>(null);
  const [cropping, setCroppingState] = useState<Cropping | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const live = useRef<Live>({ value, kept, cropping, task: null });
  live.current.value = value;
  useEffect(
    () => () => {
      const last = live.current;
      if (last.cropping?.from !== last.kept) releaseLogoSource(last.cropping?.from);
      releaseLogoSource(last.kept);
    },
    [],
  );

  const setKept = (next: LogoSource | null) => {
    live.current.kept = next;
    setKeptState(next);
  };
  const setCropping = (next: Cropping | null) => {
    live.current.cropping = next;
    setCroppingState(next);
  };
  /** Closes the crop step, freeing its image unless it is the logo's own source. */
  const closeCrop = () => {
    const open = live.current.cropping;
    if (open && open.from !== live.current.kept) releaseLogoSource(open.from);
    setCropping(null);
  };
  const track = <T>(task: Promise<T>): Promise<T> => {
    live.current.task = task;
    return task;
  };

  /** Encodes the crop, hands it out and closes the crop step; null when it is refused (the error shows). */
  const accept = (from: LogoSource, crop?: CropRect) =>
    track(
      (async (): Promise<PreparedLogo | null> => {
        setWorking(true);
        setError(undefined);
        try {
          const next = await encodeLogo(from, crop);
          releaseLogo(live.current.value);
          live.current.value = next;
          onChange(next);
          if (live.current.kept !== from) releaseLogoSource(live.current.kept);
          setKept(from);
          closeCrop();
          return next;
        } catch (failure) {
          setError(failureText(failure));
          return null;
        } finally {
          setWorking(false);
        }
      })(),
    );
  const pick = (file: File, crop = true) =>
    track(
      (async () => {
        setWorking(true);
        setError(undefined);
        try {
          const next = await loadLogoSource(file);
          closeCrop();
          if (crop) setCropping({ from: next });
          else if (!(await accept(next))) releaseLogoSource(next);
        } catch (failure) {
          setError(failureText(failure));
        } finally {
          setWorking(false);
        }
      })(),
    );
  const adjust = () => {
    const now = live.current;
    if (now.value && now.kept) setCropping({ from: now.kept, initial: now.value.crop });
  };
  const clear = () => {
    closeCrop();
    releaseLogoSource(live.current.kept);
    setKept(null);
    releaseLogo(live.current.value);
    live.current.value = null;
    setError(undefined);
    onChange(null);
  };
  /**
   * The logo a save should take: waits for an image still being read, then applies an open crop step as it stands
   * (`current`, the cropper's square; the step's start before the cropper shows). Rejects with the `LogoError` when
   * that crop is refused; the picker shows why and stays on the crop step.
   */
  const settle = async (current: () => CropRect | undefined): Promise<PreparedLogo | null> => {
    let task = live.current.task;
    while (task) {
      await task;
      task = live.current.task === task ? null : live.current.task;
    }
    const open = live.current.cropping;
    if (!open) return live.current.value;
    const crop = current() ?? open.initial ?? coverCrop(open.from);
    const next = await accept(open.from, crop);
    if (!next) throw new LogoError('unreadable');
    return next;
  };
  return { kept, cropping, working, error, pick, accept, cancel: closeCrop, adjust, clear, settle };
}
