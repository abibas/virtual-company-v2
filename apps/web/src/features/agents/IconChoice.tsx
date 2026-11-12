import { AGENT_FACE, agentFace } from '@mwc/shared/org';
import { ImageIcon, Smile, SmilePlus } from 'lucide-react';
import { useAgentIconImage } from '../../api/images/agent-icon.ts';
import type { AgentDetail, AgentIconView } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { FacePicker } from '../../components/feed/FacePicker.tsx';
import type { AgentRef } from '../../components/feed/kinds.ts';
import { EmojiPicker } from '../../components/forms/EmojiPicker.tsx';
import { LogoPicker } from '../../components/forms/image/LogoPicker.tsx';
import { releaseLogo } from '../../components/forms/image/logo-file.ts';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import type { AgentDraft } from './agent-draft.ts';
import type { IconDraft } from './icon-draft.ts';

/** Every drawn face, as choices of the face picker. */
const FACES: readonly AgentRef[] = Array.from(
  { length: AGENT_FACE.max - AGENT_FACE.min + 1 },
  (_, index) => ({
    id: String(AGENT_FACE.min + index),
    name: `Face ${index + 1}`,
    face: AGENT_FACE.min + index,
  }),
);

type IconKind = IconDraft['kind'];

const KINDS: readonly SegmentOption<IconKind>[] = [
  { value: 'face', label: 'Face', icon: Smile },
  { value: 'emoji', label: 'Emoji', icon: SmilePlus },
  { value: 'image', label: 'Image', icon: ImageIcon },
];

/** The face: drawn from the name until one is picked, and back to the name's on request. */
function FaceGrid({ draft }: { readonly draft: AgentDraft }) {
  const named = draft.face === agentFace(draft.slug);
  return (
    <div className="flex flex-col gap-1.5">
      <FacePicker
        agents={FACES}
        value={String(draft.face)}
        onChange={(id) => draft.set('face', Number(id))}
        label="Face"
        size="sm"
        className="gap-1.5"
      />
      {!named && (
        <p className="text-xs">
          <button
            type="button"
            onClick={() => draft.set('face', null)}
            className="cursor-pointer font-semibold text-blue hover:underline"
          >
            Use the face of its name
          </button>
        </p>
      )}
    </div>
  );
}

/** The image: the one it has, or one picked and cropped round here; Remove takes it back to the face on save. */
function ImageChoice({
  draft,
  agent,
  companyId,
}: {
  readonly draft: AgentDraft;
  readonly agent: AgentDetail | undefined;
  readonly companyId: string;
}) {
  const { icon } = draft.values;
  const version = agent?.icon.kind === 'image' ? agent.icon.version : null;
  const saved = useAgentIconImage(companyId, agent?.id ?? '', agent ? version : null);
  const pending = icon.kind === 'image' ? icon.pending : null;
  return (
    <LogoPicker
      kind="agent"
      name=""
      label={pending || saved ? 'Its image' : 'No image yet'}
      src={saved}
      value={pending}
      onChange={(next) => {
        if (pending && pending !== next) releaseLogo(pending);
        draft.set('icon', { kind: 'image', pending: next });
      }}
      {...(saved ? { onRemove: async () => draft.set('icon', { kind: 'face' }) } : {})}
    />
  );
}

/** What switching to a kind starts with: the emoji or image the agent has, else nothing picked yet. */
function startOf(kind: IconKind, agent: AgentDetail | undefined): IconDraft {
  if (kind === 'emoji') return { kind, emoji: agent?.icon.kind === 'emoji' ? agent.icon.emoji : '' };
  if (kind === 'image') return { kind, pending: null };
  return { kind };
}

/** The hint under the picker: what is still missing, or what the choice does. */

/** The icon the preview shows for the draft: an emoji once one is picked, the saved image, else the face. */
function previewIcon(icon: IconDraft, agent: AgentDetail | undefined): AgentIconView | undefined {
  if (icon.kind === 'emoji') return icon.emoji ? { kind: 'emoji', emoji: icon.emoji } : undefined;
  if (icon.kind === 'image' && agent?.icon.kind === 'image') return agent.icon;
  return undefined;
}

/**
 * The agent's icon in its form: Face (the drawn faces), Emoji (a curated grid and any other) or Image (upload, crop,
 * remove), previewed as it will show. Saved with the form.
 */
export function IconChoice({
  draft,
  agent,
}: {
  readonly draft: AgentDraft;
  readonly agent: AgentDetail | undefined;
}) {
  const { companyId } = useCompany().membership;
  const { icon } = draft.values;
  const shown = {
    ...(agent ? { id: agent.id } : {}),
    name: draft.values.name || 'New agent',
    face: draft.face,
    icon: previewIcon(icon, agent),
  };
  const previewSrc = icon.kind === 'image' ? (icon.pending?.url ?? null) : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <AgentIcon agent={shown} size="lg" previewSrc={previewSrc} companyId={companyId} />
        <SegmentedControl
          options={KINDS}
          value={icon.kind}
          onChange={(kind) => {
            if (kind === icon.kind) return;
            if (icon.kind === 'image') releaseLogo(icon.pending);
            draft.set('icon', startOf(kind, agent));
          }}
          label="Icon"
          size="sm"
        />
      </div>
      {icon.kind === 'face' && <FaceGrid draft={draft} />}
      {icon.kind === 'emoji' && (
        <EmojiPicker value={icon.emoji} onChange={(emoji) => draft.set('icon', { kind: 'emoji', emoji })} />
      )}
      {icon.kind === 'image' && <ImageChoice draft={draft} agent={agent} companyId={companyId} />}
      {icon.kind === 'image' && icon.pending === null && agent?.icon.kind !== 'image' && (
        <p className="text-xs text-dim">Add an image.</p>
      )}
    </div>
  );
}
