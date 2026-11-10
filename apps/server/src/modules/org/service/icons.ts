import { createHash } from 'node:crypto';
import { type Agent, type AgentIcon, diffFields, type TenantDb } from '@mwc/db';
import { type AgentIconView, agentIconView } from '@mwc/shared/agent-icons';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { agentIconRows } from '../repo/icons.ts';
import { orgRepo } from '../repo.ts';
import { AGENT_NOT_FOUND } from '../rules/agents.ts';
import {
  type AuditedIcon,
  auditedIcon,
  ICON_TOO_LARGE,
  type IconRefusal,
  iconFileType,
} from '../rules/icons.ts';
import type { Refusal } from '../rules/placement.ts';
import type { SetAgentIcon } from '../schemas/icons.ts';
import { auditEntry, type Caller } from './audit.ts';

/**
 * An agent's icon (docs/architecture.md, "Agent icons"): its drawn face, an emoji, or an uploaded image. Admins and
 * owners upload an image (`uploadAgentIcon`) or choose the face or an emoji (`setAgentIcon`, which removes the image);
 * any member reads the image (`agentIconFile`). An agent of the company, archived ones too, has one to change or read
 * (else 404 `agent_not_found`). Every change runs under the company's lock and writes the agent's audit row of its
 * `icon` field (its kind, with the emoji or the image's SHA-256), none when nothing changed.
 */

const repo = orgRepo();

type IconResult<R> = { readonly ok: true; readonly icon: AgentIconView } | R;

/** What the agent's row holds for an icon of this choice. */
const iconColumns = (choice: SetAgentIcon | { readonly kind: 'image' }) =>
  ({
    iconKind: choice.kind,
    iconEmoji: choice.kind === 'emoji' ? choice.emoji : null,
  }) as const;

/** The agent's audit row of its `icon` field; none when the icon did not change. */
function auditIcon(tx: TenantDb, caller: Caller, agentId: string, before: AuditedIcon, after: AuditedIcon) {
  return repo.audit(tx, {
    ...auditEntry(caller, 'agent', agentId, 'update'),
    changes: diffFields({ icon: before }, { icon: after }),
  });
}

/** Writes the agent's icon columns when they change. */
async function writeColumns(tx: TenantDb, agent: Agent, columns: ReturnType<typeof iconColumns>) {
  if (agent.iconKind !== columns.iconKind || agent.iconEmoji !== columns.iconEmoji) {
    await repo.updateAgent(tx, agent.id, columns);
  }
}

/** An uploaded file's bytes, the type they show and their SHA-256, or why it cannot be an icon. */
async function checkIconFile(file: Blob) {
  if (file.size > LOGO_MAX_BYTES) return ICON_TOO_LARGE;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = iconFileType(bytes);
  if (typeof contentType !== 'string') return contentType;
  return { ok: true as const, bytes, contentType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * Sets the agent's icon to an uploaded image, replacing any it had: 404 `agent_not_found` for no such agent, then 400
 * `icon_empty`, 413 `icon_too_large` over 1 MB, 415 `icon_type_unsupported` unless its bytes are a PNG, JPEG, WebP or
 * GIF image.
 */
export async function uploadAgentIcon(
  t: TenantDb,
  caller: Caller,
  agentId: string,
  file: Blob,
): Promise<IconResult<IconRefusal | Refusal<404>>> {
  if ((await repo.getAgent(t, agentId)) === undefined) return AGENT_NOT_FOUND;
  const checked = await checkIconFile(file);
  if (!checked.ok) return checked;
  const { bytes, contentType, sha256 } = checked;
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const agent = (await repo.getAgent(tx, agentId)) as Agent;
    const before = auditedIcon(agent, await agentIconRows.hash(tx, agent.id));
    const values = {
      contentType,
      bytes,
      size: bytes.length,
      sha256,
      updatedByPrincipalId: caller.principalId,
    };
    await agentIconRows.save(tx, agent.id, values);
    await writeColumns(tx, agent, iconColumns({ kind: 'image' }));
    await auditIcon(tx, caller, agent.id, before, { kind: 'image', sha256 });
    return { ok: true as const, icon: agentIconView('image', null, sha256) };
  });
}

/** Sets the agent's icon to its drawn face or an emoji, removing its image if it had one; 404 for no such agent. */
export function setAgentIcon(
  t: TenantDb,
  caller: Caller,
  agentId: string,
  choice: SetAgentIcon,
): Promise<IconResult<Refusal<404>>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const agent = await repo.getAgent(tx, agentId);
    if (agent === undefined) return AGENT_NOT_FOUND;
    const before = auditedIcon(agent, await agentIconRows.remove(tx, agent.id));
    const columns = iconColumns(choice);
    await writeColumns(tx, agent, columns);
    await auditIcon(tx, caller, agent.id, before, auditedIcon(columns, null));
    return { ok: true as const, icon: agentIconView(columns.iconKind, columns.iconEmoji, null) };
  });
}

/** The agent's image with its bytes; undefined when it has none, 404 for no such agent. */
export async function agentIconFile(
  t: TenantDb,
  agentId: string,
): Promise<{ readonly ok: true; readonly icon: AgentIcon | undefined } | Refusal<404>> {
  const agent = await repo.getAgent(t, agentId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  return { ok: true, icon: agent.iconKind === 'image' ? await agentIconRows.file(t, agent.id) : undefined };
}

/** Every agent's image SHA-256 in the company, by agent (for the agent lists' and the chart's `icon`). */
export const agentIconHashes = (t: TenantDb): Promise<Map<string, string>> => agentIconRows.hashes(t);

/** One agent's image SHA-256, null for none (for one agent's `icon`). */
export const agentIconHash = (t: TenantDb, agentId: string): Promise<string | null> =>
  agentIconRows.hash(t, agentId);

/** The icon an agent shows, from its row and its image's SHA-256 (null or undefined for none). */
export const iconOf = (agent: Agent, sha256: string | null | undefined): AgentIconView =>
  agentIconView(agent.iconKind, agent.iconEmoji, sha256);
