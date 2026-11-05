import { ArrowRight, Check } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import type { Me } from '../../api/types.ts';
import { cx } from '../cx.ts';
import { TextField } from '../forms/Field.tsx';
import { LogoPicker } from '../forms/image/LogoPicker.tsx';
import { releaseLogo } from '../forms/image/logo-file.ts';
import { Avatar } from '../ui/Avatar.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { Notice } from '../ui/Notice.tsx';
import { draftName, type ProfileDraft, SAVE_STAGES, useSaveProfile } from './profile.ts';

export interface ProfileFormProps {
  readonly draft: ProfileDraft;
  /** The photo saved already, if any. */
  readonly savedPhoto?: string | null | undefined;
  /** Offers removing the saved photo (the profile page). */
  readonly removable?: boolean;
  readonly submitLabel: string;
  /** The onboarding step: an arrow on the button, and focus on the first name. */
  readonly onboarding?: boolean;
  /** The session's `POST /api/me/reconcile`, run after each save so this server has it at once. */
  readonly reconcile: () => Promise<Me>;
  /** After a save the server has taken in: the person as it now has them. */
  readonly onSaved: (me: Me) => void;
  /** A way back, under the button. */
  readonly cancel?: ReactNode;
  readonly className?: string;
}

/** The first and last name side by side (one above the other on phones), both required. */
function NameFields({ draft, disabled }: { readonly draft: ProfileDraft; readonly disabled: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="First name"
        value={draft.firstName}
        onChange={(event) => draft.setFirstName(event.target.value)}
        required
        maxLength={64}
        autoComplete="given-name"
        placeholder="Ihor"
        disabled={disabled}
      />
      <TextField
        label="Last name"
        value={draft.lastName}
        onChange={(event) => draft.setLastName(event.target.value)}
        required
        maxLength={64}
        autoComplete="family-name"
        placeholder="Herasko"
        disabled={disabled}
      />
    </div>
  );
}

/**
 * The person's photo (optional, cropped round) and their first and last name (required), and the button that saves
 * them at the sign-in service and here. A saved photo can be replaced, or removed when `removable`.
 */
export function ProfileForm(props: ProfileFormProps) {
  const { draft, savedPhoto, removable = false, submitLabel, onboarding = false, onSaved, cancel } = props;
  const saving = useSaveProfile(props.reconcile);
  const filled = draft.firstName.trim() !== '' && draft.lastName.trim() !== '';
  const finish = (me: Me | undefined) => {
    if (!me) return;
    releaseLogo(draft.photo);
    draft.setPhoto(null);
    onSaved(me);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = { firstName: draft.firstName.trim(), lastName: draft.lastName.trim() };
    finish(await saving.save(name, draft.photo));
  };
  return (
    <form onSubmit={(event) => void submit(event)} className={cx('flex flex-col gap-5', props.className)}>
      <LogoPicker
        kind="photo"
        name={draftName(draft)}
        src={savedPhoto}
        value={draft.photo}
        onChange={draft.setPhoto}
        {...(removable && savedPhoto ? { onRemove: async () => finish(await saving.removePhoto()) } : {})}
        busy={saving.stage === 'photo'}
        disabled={saving.busy}
      />
      <NameFields draft={draft} disabled={saving.busy} />
      {saving.error !== undefined && <Notice tone="error">{saving.error}</Notice>}
      <div className="flex flex-col items-center gap-3 pt-1">
        <Button
          type="submit"
          tone="primary"
          size="lg"
          busy={saving.busy}
          disabled={!filled}
          {...(onboarding ? { trailingIcon: ArrowRight } : { icon: Check })}
          className="w-full"
        >
          {saving.stage === 'idle' ? submitLabel : SAVE_STAGES[saving.stage]}
        </Button>
        {cancel}
      </div>
    </form>
  );
}

/** What the team will see, as it is typed: the person's face and name on a card like the org chart's. */
export function ProfilePreview({
  draft,
  savedPhoto,
  email,
}: {
  readonly draft: ProfileDraft;
  readonly savedPhoto?: string | null | undefined;
  readonly email: string;
}) {
  const name = draftName(draft);
  return (
    <Card padding="none" className="mx-auto w-full max-w-xs overflow-hidden">
      <span aria-hidden="true" className="block h-[3px] bg-blue" />
      <div className="flex items-center gap-3 p-4">
        <Avatar name={name || email} src={draft.photo?.url ?? savedPhoto} size="lg" tone="gradient" />
        <div className="min-w-0">
          <p className={cx('truncate text-md font-bold', name ? 'text-ink' : 'text-dim')}>
            {name || 'Your name'}
          </p>
          <p className="truncate text-xs text-dim">{email}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <Badge tone="blue" size="sm">
          On the org chart
        </Badge>
        <Badge tone="neutral" size="sm">
          In the top bar
        </Badge>
      </div>
    </Card>
  );
}
