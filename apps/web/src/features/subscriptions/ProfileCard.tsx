import { isAiPart, PROFILE_PARTS, PROFILE_PROVIDERS, type ProfilePart } from '@mwc/shared/credentials';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { count } from '../../components/data/format.ts';
import { profileLine } from '../../components/org/agent-labels.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { AiPartSection, aiPartChange } from './AiPartSection.tsx';
import { type CardProps, ProfileAgents, ProfileHeader } from './ProfileParts.tsx';
import { PART_STYLES } from './Providers.tsx';
import { firstSignIn, firstSubscription } from './profile-options.ts';
import { ToolPartSection, toolPartChange } from './ToolPartSection.tsx';

/**
 * "Add Claude · Add OpenAI · Add GitHub · Add Atlassian" for the parts the profile does not have, Claude and OpenAI only
 * while it has neither (a profile runs one AI): each adds its part with the person's first credential of that kind (an
 * AI part its provider's subscription, a tool part its sign-in and its tool's safe rights).
 */
function AddParts({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  const [busy, setBusy] = useState<ProfilePart>();
  const [error, setError] = useState<string>();
  const hasAi = PROFILE_PROVIDERS.some((provider) => profile.parts[provider] !== null);
  const missing = PROFILE_PARTS.filter((part) => profile.parts[part] === null && !(hasAi && isAiPart(part)));
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

/** Whether a card is open, and the way to open or fold it (the list keeps one open at a time). */
export interface FoldProps {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** A folded profile: one row with its name, its parts in a line and how many agents use it; a click opens it. */
function FoldedProfile({ profile, onToggle }: Pick<CardProps, 'profile'> & Pick<FoldProps, 'onToggle'>) {
  const users = profile.agents.length;
  return (
    <Card as="article" aria-label={profile.name} padding="sm">
      <button
        type="button"
        aria-expanded={false}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-1 py-0.5 text-left"
      >
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-dim" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink">{profile.name}</span>
          <span className="block truncate text-xs text-dim">{profileLine(profile)}</span>
        </span>
        {users > 0 && <span className="shrink-0 text-xs text-dim">{count(users, 'agent')}</span>}
      </button>
    </Card>
  );
}

/**
 * One profile (generic since 2026-11-13). Folded, one row: its name, its parts in a line and how many agents use it.
 * Open: its name (renamed in place) and Delete; its parts as sections in a fixed order (Claude, OpenAI, GitHub,
 * Atlassian; Claude or OpenAI, never both), each saved as it changes and removable; Add for the parts it does not have;
 * and which agents use it.
 */
export function ProfileCard({
  profile,
  subscriptions,
  update,
  remove,
  open,
  onToggle,
}: CardProps & FoldProps) {
  if (!open) return <FoldedProfile profile={profile} onToggle={onToggle} />;
  const { claude, openai, github, atlassian } = profile.parts;
  const shared = { subscriptions, update };
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded
          aria-label={`Fold ${profile.name}`}
          onClick={onToggle}
          className="mt-0.5 shrink-0 cursor-pointer rounded-lg p-1 text-dim hover:text-ink"
        >
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <ProfileHeader profile={profile} update={update} remove={remove} />
        </div>
      </div>
      {claude && <AiPartSection key={`claude-${profile.id}`} provider="claude" part={claude} {...shared} />}
      {openai && <AiPartSection key={`openai-${profile.id}`} provider="openai" part={openai} {...shared} />}
      {github && <ToolPartSection tool="github" part={github} {...shared} />}
      {atlassian && <ToolPartSection tool="atlassian" part={atlassian} {...shared} />}
      <AddParts profile={profile} {...shared} />
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}
