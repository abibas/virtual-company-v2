/**
 * The rail's Chats tests' helpers (docs/harness.md "Your direct reports in the rail"): a person's direct reports' chats
 * read through the API, and chats and turns written straight into the company's tenant with the fields the main chat's
 * choice and a chat's standing read (who began it, its task or flow, when it last moved; a turn's kind, status, sender
 * and times).
 */
import { chats, chatTurns, tenant } from '@mwc/db';
import type { ChatTurnKind, ChatTurnStatus } from '@mwc/shared/enums';
import type { ReportChatView } from '../../../src/modules/chats/schemas/reports.ts';
import { as, type MembersCompany } from '../members/members.ts';
import type { AuthWorld, Person } from '../platform/auth.ts';

export type { ReportChatView };

export const reportChatsPath = (company: Pick<MembersCompany, 'companyId'>) =>
  `/api/companies/${company.companyId}/me/report-chats`;

/** A person's direct reports' chats; the test fails on anything but a 200. */
export async function reportChatsOf(
  w: AuthWorld,
  person: Person,
  company: Pick<MembersCompany, 'companyId'>,
): Promise<ReportChatView[]> {
  const res = await as(w, person)('GET', reportChatsPath(company));
  if (res.status !== 200)
    throw new Error(`GET report-chats answered ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as { reports: ReportChatView[] }).reports;
}

/** A chat of the agent on the machine, begun by `createdBy`, moved last at `updatedAt`; its id. */
export async function chatRowOf(
  w: AuthWorld,
  company: Pick<MembersCompany, 'companyId'>,
  fields: {
    readonly agentId: string;
    readonly machineId: string;
    readonly createdBy: string;
    readonly updatedAt: Date;
    readonly title?: string;
    readonly task?: { readonly id: string; readonly stepId: string };
    readonly flowId?: string;
    readonly archivedAt?: Date;
  },
): Promise<string> {
  const t = await tenant(w.t.db, company.companyId);
  const task = fields.task ? { taskId: fields.task.id, taskStepId: fields.task.stepId, taskRound: 1 } : {};
  const [row] = await t
    .insert(chats, {
      agentId: fields.agentId,
      harness: 'claude_code',
      machineId: fields.machineId,
      title: fields.title ?? 'A chat',
      createdBy: fields.createdBy,
      updatedAt: fields.updatedAt,
      createdAt: fields.updatedAt,
      flowId: fields.flowId ?? null,
      archivedAt: fields.archivedAt ?? null,
      ...task,
    })
    .returning();
  return (row as { id: string }).id;
}

/** A turn of the chat: its number, kind, status, sender and times. */
export interface TurnFields {
  readonly seq: number;
  readonly createdBy: string;
  readonly at: Date;
  readonly status?: ChatTurnStatus;
  readonly kind?: ChatTurnKind;
  readonly system?: boolean;
  /** When it ended; left out: `at` plus a minute for an ended turn, none for a queued or running one. */
  readonly endedAt?: Date | null;
}

const MINUTE = 60_000;

/** Writes the chat's turn; its id. */
export async function turnRowOf(
  w: AuthWorld,
  company: Pick<MembersCompany, 'companyId'>,
  chatId: string,
  fields: TurnFields,
): Promise<string> {
  const t = await tenant(w.t.db, company.companyId);
  const status = fields.status ?? 'done';
  const live = status === 'queued' || status === 'running';
  const endedAt = fields.endedAt !== undefined ? fields.endedAt : live ? null : new Date(+fields.at + MINUTE);
  const [row] = await t
    .insert(chatTurns, {
      chatId,
      seq: fields.seq,
      kind: fields.kind ?? 'message',
      prompt: `Message ${fields.seq}`,
      status,
      system: fields.system ?? false,
      createdBy: fields.createdBy,
      createdAt: fields.at,
      startedAt: status === 'queued' ? null : fields.at,
      endedAt,
    })
    .returning();
  return (row as { id: string }).id;
}
