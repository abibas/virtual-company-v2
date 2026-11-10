import type { AgentIconView } from '@mwc/shared/agent-icons';
import type { AgentStatus } from '@mwc/shared/enums';
import { type CSSProperties, useContext, useState } from 'react';
import { useAgentIconImage } from '../../api/agent-icon.ts';
import { CompanyContext } from '../../app/company.ts';
import { cx } from '../cx.ts';
import { Avatar, type AvatarSize } from '../ui/Avatar.tsx';
import { AgentFace } from './AgentFace.tsx';

/** What `AgentIcon` draws an agent from: its drawn face (always, the fallback), its icon, and its status. */
export interface AgentIconSubject {
  /** The agent's id, for its image; none for a face that is not an agent's yet (a picker's choices, a preview). */
  readonly id?: string;
  readonly name: string;
  readonly face?: number;
  /** Its icon as the API shows it; none draws the face. */
  readonly icon?: AgentIconView | undefined;
  /** Paused and archived agents are drawn muted. */
  readonly status?: AgentStatus;
}

export interface AgentIconProps {
  readonly agent: AgentIconSubject;
  readonly size?: AvatarSize;
  /** Muted (greyed) whatever its status: a disabled choice. */
  readonly muted?: boolean | undefined;
  /** A blue ring: the selected one in a picker. */
  readonly selected?: boolean;
  /** The company whose agent it is, for its image; the company on screen when left out. */
  readonly companyId?: string | undefined;
  /** A picked image not saved yet (a preview's object URL), shown in place of the icon. */
  readonly previewSrc?: string | null | undefined;
  readonly className?: string;
}

/** An emoji's size in each avatar size: about half the tile. */
const EMOJI_SIZES: Readonly<Record<AvatarSize, string>> = {
  xs: 'text-sm',
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-4xl',
  '2xl': 'text-5xl',
};

const MUTED: CSSProperties = { filter: 'grayscale(1)', opacity: 0.55 };

/** The image, loaded lazily; one that does not load gives way to the face. */
function IconImage({
  src,
  muted,
  onBroken,
}: {
  readonly src: string;
  readonly muted: boolean;
  readonly onBroken: () => void;
}) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={onBroken}
      className="size-full bg-white object-cover"
      style={muted ? MUTED : undefined}
    />
  );
}

/** The emoji on a soft teal tile. */
function IconEmoji({
  emoji,
  size,
  muted,
}: {
  readonly emoji: string;
  readonly size: AvatarSize;
  readonly muted: boolean;
}) {
  return (
    <span
      className={cx(
        'flex size-full items-center justify-center bg-teal-soft leading-none font-normal',
        EMOJI_SIZES[size],
      )}
      style={muted ? MUTED : undefined}
    >
      {emoji}
    </span>
  );
}

/**
 * What fills an agent's round tile (`AgentIcon`, or an `Avatar`'s `fallback` as in an `AvatarStack`): its image, its
 * emoji or its drawn face.
 */
export function AgentIconArt({
  agent,
  size = 'md',
  muted,
  companyId,
  previewSrc,
}: Omit<AgentIconProps, 'selected' | 'className'>) {
  const company = useContext(CompanyContext);
  const icon = agent.icon ?? { kind: 'face' as const };
  const version = icon.kind === 'image' ? icon.version : null;
  const loaded = useAgentIconImage(
    companyId ?? company?.membership.companyId,
    agent.id ?? '',
    agent.id ? version : null,
  );
  const [broken, setBroken] = useState<string>();
  const dim = muted ?? (agent.status !== undefined && agent.status !== 'active');
  const src = previewSrc ?? loaded;
  let drawn = <AgentFace variant={agent.face ?? 0} muted={dim} />;
  if (src && src !== broken) drawn = <IconImage src={src} muted={dim} onBroken={() => setBroken(src)} />;
  else if (icon.kind === 'emoji' && !previewSrc)
    drawn = <IconEmoji emoji={icon.emoji} size={size} muted={dim} />;
  return drawn;
}

/**
 * An agent wherever it appears: its uploaded image (round, loaded lazily, its drawn face while it loads or when it
 * cannot), its emoji on a soft tile, else its drawn face; muted while it is paused or archived. Decorative: the name
 * travels with it.
 */
export function AgentIcon({ agent, size = 'md', selected = false, className, ...art }: AgentIconProps) {
  return (
    <Avatar
      name={agent.name}
      size={size}
      fallback={<AgentIconArt agent={agent} size={size} {...art} />}
      selected={selected}
      {...(className ? { className } : {})}
    />
  );
}
