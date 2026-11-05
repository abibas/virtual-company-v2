import { useUser } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, friendlyMessage } from '../../api/errors.ts';
import type { Me } from '../../api/types.ts';
import { type PreparedLogo, releaseLogo } from '../forms/image/logo-file.ts';

/**
 * The person's profile (Ihor's request of 2026-11-05): their first and last name and their photo live at the sign-in
 * service (Clerk), so its own account page and ours agree; this server keeps a copy that every sync path refreshes.
 * A save writes them with clerk-js, then asks this server to reconcile the person at once, so the page shows them.
 */

export interface ProfileDraft {
  readonly firstName: string;
  readonly lastName: string;
  /** The photo picked here and not saved yet. */
  readonly photo: PreparedLogo | null;
  setFirstName(value: string): void;
  setLastName(value: string): void;
  setPhoto(photo: PreparedLogo | null): void;
}

/** The name a draft makes, as the server will show it: the first and last name, trimmed, joined by a space. */
export function draftName(draft: Pick<ProfileDraft, 'firstName' | 'lastName'>): string {
  return [draft.firstName, draft.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/** What is typed and picked, starting from the names the sign-in service has (a social sign-up may bring them). */
export function useProfileDraft(): ProfileDraft {
  const { user } = useUser();
  const [firstName, setFirstName] = useState(() => user?.firstName ?? '');
  const [lastName, setLastName] = useState(() => user?.lastName ?? '');
  const [photo, setPhoto] = useState<PreparedLogo | null>(null);
  const latest = useRef(photo);
  latest.current = photo;
  useEffect(() => () => releaseLogo(latest.current), []);
  return { firstName, lastName, photo, setFirstName, setLastName, setPhoto };
}

type Stage = 'idle' | 'name' | 'photo' | 'sync';

/** What the button says while a save runs. */
export const SAVE_STAGES: Readonly<Record<Exclude<Stage, 'idle'>, string>> = {
  name: 'Saving your name…',
  photo: 'Saving your photo…',
  sync: 'Updating your profile…',
};

/** The server gives one reconcile per person every 10 seconds; a second save inside them waits this long, once. */
const RECONCILE_WAIT_MS = 10_500;

async function reconcileNow(reconcile: () => Promise<Me>): Promise<Me> {
  try {
    return await reconcile();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'rate_limited') throw error;
    await new Promise((resolve) => setTimeout(resolve, RECONCILE_WAIT_MS));
    return reconcile();
  }
}

/** A refusal of the sign-in service in its own words (Clerk's `errors[0].longMessage`), else the API's plain words. */
function saveMessage(error: unknown): string {
  const clerk = (error as { errors?: readonly { longMessage?: string; message?: string }[] } | null)
    ?.errors?.[0];
  return clerk?.longMessage ?? clerk?.message ?? friendlyMessage(error);
}

export interface SavedName {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Saves the profile: the names with `user.update` (when they changed), the picked photo with `setProfileImage`, then
 * `reconcile` (the session's `POST /api/me/reconcile`), whose answer (the person as this server now has them) it
 * returns; undefined after a failure, which `error` says in plain words. `removePhoto` takes the saved photo away the
 * same way.
 */
export function useSaveProfile(reconcile: () => Promise<Me>) {
  const { user } = useUser();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string>();

  const run = async (steps: (person: NonNullable<typeof user>) => Promise<void>) => {
    if (!user) {
      setError('Your sign-in is still loading. Try again in a moment.');
      return undefined;
    }
    setError(undefined);
    try {
      await steps(user);
      setStage('sync');
      return await reconcileNow(reconcile);
    } catch (failure) {
      setError(saveMessage(failure));
      return undefined;
    } finally {
      setStage('idle');
    }
  };

  const save = (name: SavedName, photo: PreparedLogo | null) =>
    run(async (person) => {
      if (person.firstName !== name.firstName || person.lastName !== name.lastName) {
        setStage('name');
        await person.update(name);
      }
      if (photo) {
        setStage('photo');
        await person.setProfileImage({ file: photo.blob });
      }
    });

  const removePhoto = () =>
    run(async (person) => {
      setStage('photo');
      await person.setProfileImage({ file: null });
    });

  return { stage, busy: stage !== 'idle', error, save, removePhoto };
}
