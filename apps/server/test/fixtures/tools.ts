/**
 * The agents' tools' tests helpers (S6a): the team's scene on a runner that offers the tools (its Lead placed too), a
 * tool call relayed as the runner does (`turn.tool`, answered by `turn.tool.result`), a file a call attaches, and a
 * chat with the Lead agent. Never a real CLI: the runner is the fake.
 */
import { randomUUID } from 'node:crypto';
import type { TurnStart, TurnToolResult } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { beginChat, type ChatsWorld, sendPrompt } from './chats/world.ts';
import { agentOf, fileFrames, type RunOptions, type RunScene, runScene } from './runs.ts';

/** The team's scene (`runScene`) on a runner that offers the agents' tools, with the Lead placed. */
export const toolScene = (w: ChatsWorld, options: RunOptions = {}): Promise<RunScene> =>
  runScene(w, { ...options, placeLead: true, caps: { agentTools: true, ...options.caps } });

/** The runner relays a call of the turn's tool and gives the server's answer to it. */
export async function toolCall(
  runner: FakeRunner,
  turnId: string,
  tool: string,
  input: Record<string, unknown> = {},
  callId: string = randomUUID(),
): Promise<TurnToolResult> {
  runner.send({ type: 'turn.tool', turnId, callId, tool, input });
  const result = await runner.frames.next('turn.tool.result');
  if (result.callId !== callId || result.turnId !== turnId) throw new Error('an answer to another call');
  return result;
}

/** A file `task_attach {path}` sends: its parts with the call's id, then the call with the file's facts. */
export async function attachFile(
  runner: FakeRunner,
  turnId: string,
  path: string,
  bytes: Uint8Array,
  options: { readonly sha256?: string; readonly name?: string } = {},
): Promise<TurnToolResult> {
  const callId = randomUUID();
  const parts = fileFrames(turnId, 0, path, bytes, options.sha256 ? { sha256: options.sha256 } : {});
  for (const part of parts) runner.send({ ...part, callId });
  const [first] = parts;
  const file = { path, contentType: first?.contentType, size: bytes.length, sha256: first?.sha256 };
  return toolCall(
    runner,
    turnId,
    'task_attach',
    { path, file, ...(options.name ? { name: options.name } : {}) },
    callId,
  );
}

/** A chat with the Lead agent, begun by the owner, and its first turn as the runner got it. */
export async function leadTurn(
  w: ChatsWorld,
  s: RunScene,
  prompt = 'What is on the board?',
): Promise<{ readonly chatId: string; readonly start: TurnStart }> {
  const lead = await agentOf(w.t.db, s.c.lead);
  const chat = await beginChat(w, s.c, lead.id);
  const res = await sendPrompt(w, { company: s.c, chat }, prompt);
  if (res.status !== 202) throw new Error(`POST turns answered ${res.status}: ${JSON.stringify(res.body)}`);
  return { chatId: chat.id, start: await s.runner.frames.next('turn.start') };
}
