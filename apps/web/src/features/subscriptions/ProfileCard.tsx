import { isAiPart, PROFILE_PARTS, type ProfilePart } from '@mwc/shared/credentials';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { AiPartSection, aiPartChange } from './AiPartSection.tsx';
import { type CardProps, ProfileAgents, ProfileHeader } from './ProfileParts.tsx';
import { PART_STYLES } from './Providers.tsx';
import { firstSignIn, firstSubscription } from './profile-options.ts';
import { ToolPartSection, toolPartChange } from './ToolPartSection.tsx';

/**
 * "Add Claude · Add OpenAI · Add GitHub · Add Atlassian" for the parts the profile does not have: each adds its part with
 * the person's first credential of that kind (an AI part its provider's subscription, a tool part its sign-in and its
 * tool's safe rights).
 */
function AddParts({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  const [busy, setBusy] = useState<ProfilePart>();
  const [error, setError] = useState<string>();
  const missing = PROFILE_PARTS.filter((part) => profile.parts[part] === null);
  if (missing.length === 0) return null;
  const add = async (part: ProfilePart) => {
    setBusy(part);
    setError(undefined);
    try {
      await update(
        isAiPart(part)
          ? aiPartChange(part, { credentialId: firstSubscription(part, subscriptions) })
          : toolPartChange(part, { credentialId: firstSignIn(part, subscriptions) }),
      );
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {missing.map((part) => (
        <Button
          key={part}
          size="sm"
          tone="quiet"
          icon={Plus}
          busy={busy === part}
          disabled={busy !== undefined}
          onClick={() => void add(part)}
        >
          Add {PART_STYLES[part].name}
        </Button>
      ))}
      {error && (
        <span role="alert" className="text-xs font-medium text-failed">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * One profile (generic since 2026-11-13): its name (renamed in place) and Delete; its parts as sections in a fixed order
 * (Claude, OpenAI, GitHub, Atlassian), each saved as it changes and removable; Add for the parts it does not have; and
 * which agents use it.
 */
export function ProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  const { claude, openai, github, atlassian } = profile.parts;
  const shared = { subscriptions, update };
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <ProfileHeader profile={profile} update={update} remove={remove} />
      {claude && <AiPartSection key={`claude-${profile.id}`} provider="claude" part={claude} {...shared} />}
      {openai && <AiPartSection key={`openai-${profile.id}`} provider="openai" part={openai} {...shared} />}
      {github && <ToolPartSection tool="github" part={github} {...shared} />}
      {atlassian && <ToolPartSection tool="atlassian" part={atlassian} {...shared} />}
      <AddParts profile={profile} {...shared} />
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}
