import { z } from 'zod';
import { frame, protocolObject, Uuid } from './common.ts';

/**
 * Turns that survive restarts (S5.4, docs/harness.md "Surviving restarts"): a runner keeps each turn's process in a run
 * folder of its own, so a dropped link, a runner restart or a server restart leaves the turn running. A runner that
 * holds turns names them in its hello (`runner.hello.turns`: each one's id, the highest event number it gave and
 * whether its process already ended); the server answers once with `turn.resume`, the highest event number it stored
 * for each (the runner resends what follows), or null for a turn it no longer has (the runner stops it and forgets
 * it). Once the server recorded a turn's end it says `turn.ack`, and the runner removes the turn's folder.
 */

/** The most turns one hello names: live ones and ended ones whose end the server has not acknowledged. */
export const HELD_TURNS_MAX = 256;

/**
 * How long the server keeps a turn whose runner went away (its link dropped, or the server restarted) waiting for that
 * runner to say hello with it, before it fails the turn (`machine_disconnected`, `server_restarted`): 30 minutes since
 * 2026-11-12 (180 s before, which a network outage of a few minutes outlasted). A runner that comes back later still
 * gets the turn back while nothing else ran in its chat (docs/harness.md "Surviving restarts").
 */
export const TURN_REATTACH_GRACE_MS = 30 * 60_000;

/** A turn a runner holds as it says hello. */
export const HeldTurn = protocolObject({
  turnId: Uuid,
  /** The highest event number the runner gave the turn; 0 before its first event. */
  lastSeq: z.int().nonnegative(),
  /** True once its process ended (the runner still has its last events, files and end to deliver). */
  ended: z.boolean().default(false),
});
export type HeldTurn = z.infer<typeof HeldTurn>;

/** The turns a hello names (`runner.hello.turns`). */
export const HeldTurns = z.array(HeldTurn).max(HELD_TURNS_MAX);

/** The server's word on one held turn: the highest event number it stored, or null when it has no such live turn. */
export const ResumedTurn = protocolObject({
  turnId: Uuid,
  lastSeq: z.int().nonnegative().nullable(),
});
export type ResumedTurn = z.infer<typeof ResumedTurn>;

/**
 * Server to runner, once after `server.hello` when the hello named turns: for each, the highest event number stored
 * (the runner resends the events after it, then goes on live), or null (the runner stops that turn and forgets it). No
 * answer.
 */
export const TurnResume = frame('turn.resume', {
  turns: z.array(ResumedTurn).max(HELD_TURNS_MAX),
});
export type TurnResume = z.infer<typeof TurnResume>;

/** Server to runner: the turn's end is recorded; the runner removes the turn's folder. No answer. */
export const TurnAck = frame('turn.ack', {
  turnId: Uuid,
});
export type TurnAck = z.infer<typeof TurnAck>;
