/**
 * The Atlassian tools' tests helpers (S7.1c): a chat scene (`scene`) whose runner takes the server's tools and whose
 * profile has an Atlassian part (a sign-in sealed as the store does, and its rights), a turn started on it, a call of a
 * tool relayed as the runner does, and the fake provider's answers at the sealed sign-in's site. Never a real Atlassian:
 * every call goes to the fake provider (`w.provider`).
 */
import { accessProfiles, agents, auditLog, credentials, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { AtlassianRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { and, asc, eq } from 'drizzle-orm';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { type ChatsWorld, type Scene, type SceneOptions, scene, startedTurn } from '../chats/world.ts';
import { json } from '../credentials/providers.ts';
import { addSignIn } from '../org.ts';
import { toolCall } from '../tools.ts';

/** The site the sealed test sign-in names (its secret's), where the connector calls. */
export const SITE = 'https://airia.atlassian.net';
export const JIRA = `${SITE}/rest/api/3`;
export const WIKI = `${SITE}/wiki`;

/** Rights that read Jira in AP and Confluence in ENG, unless changed. */
export const READ_AP: AtlassianRights = {
  jira: 'read',
  jiraProjects: ['AP'],
  confluence: 'read',
  confluenceSpaces: ['ENG'],
};

export interface AtlassianSceneOptions extends SceneOptions {
  readonly rights?: Partial<AtlassianRights> | null;
  /** Leave the part without a sign-in. */
  readonly noSignIn?: boolean;
}

export interface AtlassianScene extends Scene {
  readonly signIn: SubscriptionView;
}

/** Sets a profile's Atlassian part straight in the table (no rules checked): its sign-in and rights, or none. */
export async function putAtlassianPart(
  db: DbHandle,
  profileId: string,
  part: { readonly credentialId: string | null; readonly rights: AtlassianRights | null },
): Promise<void> {
  await rawDb(db)
    .update(accessProfiles)
    .set({ atlassianCredentialId: part.credentialId, atlassianRights: part.rights })
    .where(eq(accessProfiles.id, profileId));
}

/** The chat scene on a runner that takes the server's tools, its profile with an Atlassian part (`READ_AP`). */
export async function atlassianScene(
  w: ChatsWorld,
  options: AtlassianSceneOptions = {},
): Promise<AtlassianScene> {
  const s = await scene(w, { ...options, caps: { serverTools: true, ...options.caps } });
  const signIn = await addSignIn(w, w.keyring, s.company.owner.userId, 'atlassian_api_token');
  const rights = options.rights === null ? null : { ...READ_AP, ...options.rights };
  await putAtlassianPart(w.t.db, s.profile.id, { credentialId: options.noSignIn ? null : signIn.id, rights });
  return { ...s, signIn };
}

/** A turn started on the scene, as the runner got it. */
export const atlassianTurn = (w: ChatsWorld, s: Scene, prompt = 'What are my last 5 Jira tickets?') =>
  startedTurn(w, s, prompt);

/** A call of a tool in the turn, relayed as the runner does: the server's answer. */
export const callTool = (s: Scene, start: TurnStart, tool: string, input: Record<string, unknown> = {}) =>
  toolCall(s.runner as FakeRunner, start.turnId, tool, input);

/** The names of the server's tools a turn's spec carries. */
export const serverToolNames = (start: TurnStart) => (start.spec.serverTools ?? []).map((tool) => tool.name);

/** A Jira issue as Jira v3 gives it. */
export const rawIssue = (key: string, project: string, summary = `Issue ${key}`) => ({
  id: String(10_000 + Number(key.split('-')[1])),
  key,
  fields: {
    summary,
    status: { name: 'In Progress' },
    issuetype: { name: 'Task' },
    assignee: { displayName: 'Ihor Herasko' },
    project: { key: project },
    description: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `About ${key}.` }] }],
    },
  },
});

/** The fake provider answers an issue (any query) with Jira's shape. */
export const answerIssue = (w: ChatsWorld, key: string, project: string) =>
  w.provider.route('GET', `${JIRA}/issue/${key}`, json(200, rawIssue(key, project)));

/** The audit rows the tools wrote for an entity, oldest first, as `[action, by, requestId, field, new]`. */
export async function toolAudit(db: DbHandle, entityType: string, entityId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map(
    (row) => [row.action, row.actorPrincipalId, row.requestId, row.field, row.newValue] as const,
  );
}

/** An agent's principal, read straight from the table. */
export const principalOf = async (db: DbHandle, agentId: string) =>
  (await rawDb(db).select().from(agents).where(eq(agents.id, agentId)))[0]?.principalId as string;

/** A sign-in's status as stored. */
export const statusOf = async (db: DbHandle, credentialId: string) =>
  (await rawDb(db).select().from(credentials).where(eq(credentials.id, credentialId)))[0]?.status;

/** A tool's answer read as JSON (the test fails when it is not). */
export const answerOf = (result: { readonly ok: boolean; readonly text: string }) =>
  JSON.parse(result.text) as Record<string, unknown>;
