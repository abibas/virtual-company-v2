import type { RoomMessage, TenantDb } from '@mwc/db';
import { ROOM_PROMPT_LINES, type RoomPromptLine, roomPrompt } from '@mwc/shared/flows';
import type { TasksRepo } from '../../repo.ts';
import { capWords, mayWrite, NOT_IN_TEAM, notAskedWords, overCap, recipients } from '../../rules/room.ts';
import { HOUR_MS } from '../../rules/wake.ts';
import { FLOW_NOT_FOUND, type Refusal } from '../../rules.ts';
import type { Caller } from '../audit.ts';
import { type RoomContext, type RoomDeps, roomContext } from './members.ts';
import { postNotice } from './post.ts';

/**
 * A person writes in a flow's team room (docs/processes.md "The team room"; Ihor's choice: "everyone may chime in"). The
 * team's people and the company's admins and owners write (`mayWrite`); the message is stored, then each agent it asks
 * (those it names with "@", else every agent of the room) gets a turn in its own room conversation (the chats module's
 * `TeamChats.say`), with the room's messages since its last turn there and this one: it answers in the room or stays
 * silent. Past the room's cap for the hour nobody is asked; agents a turn could not be queued for (paused, a stopped
 * machine whose policy does not start it for a message, no placement) are named in a notice. Nothing an agent posts
 * asks anyone, so no loop starts.
 */

/** What a person's message did: the message, and the agents it began a turn for. */
export type Said = { readonly ok: true; readonly message: RoomMessage } | Refusal<403 | 404>;

const MOST_WANTED = 'Most Wanted';

/** The prompt for one agent: what came since its last turn in the room, the message and the ask. */
async function promptFor(
  repo: TasksRepo,
  t: TenantDb,
  room: RoomContext & { readonly recent: readonly RoomMessage[] },
  agent: string,
  message: RoomMessage,
) {
  const after = await repo.room.lastStartedAt(t, room.flow.id, agent);
  const author = (id: string | null) => (id === null ? MOST_WANTED : room.names(id).name);
  const earlier: RoomPromptLine[] = room.recent
    .filter((row) => row.id !== message.id && (after === null || row.createdAt > after))
    .map((row) => ({ author: author(row.authorPrincipalId), kind: row.kind, text: row.body }));
  const name = (id: string) => room.names(id).name;
  return roomPrompt({
    flow: room.flow.name,
    you: name(agent),
    lead: agent === room.flow.leadPrincipalId ? null : name(room.flow.leadPrincipalId),
    agents: room.members.agents.map(name),
    people: room.members.people.map(name),
    earlier,
    message: { author: author(message.authorPrincipalId), text: message.body },
  });
}

/** Asks each agent for its turn; the turns begun (not joined into one still waiting) and those not asked, with why. */
async function ask(
  deps: RoomDeps,
  repo: TasksRepo,
  t: TenantDb,
  room: RoomContext,
  of: { readonly message: RoomMessage; readonly agents: readonly string[] },
) {
  const recent = await repo.room.since(t, room.flow.id, null, ROOM_PROMPT_LINES.count + 1);
  let begun = 0;
  const missed: { name: string; why: string }[] = [];
  for (const agent of of.agents) {
    const prompt = await promptFor(repo, t, { ...room, recent }, agent, of.message);
    const request = { flowId: room.flow.id, flowName: room.flow.name, agentPrincipalId: agent, prompt };
    const sent = await deps.team?.say(t, { ...request, roomMessageId: of.message.id });
    if (sent === undefined) continue;
    if (sent.ok && !sent.merged) begun++;
    if (!sent.ok) missed.push({ name: room.names(agent).name, why: sent.message });
  }
  return { begun, missed };
}

/** Stores a person's message and asks the agents it is for (see above). Outside any transaction. */
export async function sayInRoom(
  deps: RoomDeps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  said: { readonly flowId: string; readonly body: string; readonly now: Date },
): Promise<Said> {
  const flow = await repo.flows.get(t, said.flowId);
  if (flow === undefined) return FLOW_NOT_FOUND;
  const room = await roomContext(deps, repo, t, flow, [caller.principalId]);
  if (!mayWrite(caller, room.members)) return NOT_IN_TEAM;
  const agents = recipients(said.body, room.agents);
  const named = agents.length < room.agents.length ? agents : [];
  const message = await repo.room.insert(t, {
    flowId: flow.id,
    kind: 'message',
    authorPrincipalId: caller.principalId,
    body: said.body,
    details: { to: named },
    asked: 0,
    createdAt: said.now,
  });
  const notice = (body: string) =>
    postNotice(repo, t, { flowId: flow.id, body, about: 'not_asked', now: said.now });
  const asked = await repo.room.askedSince(t, flow.id, new Date(said.now.getTime() - HOUR_MS));
  if (overCap(asked, agents.length, flow.roomMaxPerHour)) {
    await notice(
      capWords(
        agents.map((id) => room.names(id).name),
        flow.roomMaxPerHour,
      ),
    );
    return { ok: true, message };
  }
  const { begun, missed } = await ask(deps, repo, t, room, { message, agents });
  if (begun > 0) await repo.room.setAsked(t, message.id, begun);
  if (missed.length > 0) await notice(notAskedWords(missed));
  return { ok: true, message: { ...message, asked: begun } };
}
