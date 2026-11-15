import { z } from 'zod';
import { HoldDriver, PowerProvider } from '../machines.ts';
import { protocolObject } from './common.ts';
import { RunnerTools } from './tools.ts';
import { RunnerHarnesses } from './turns.ts';
import { ContainerId } from './update.ts';

/** What a runner says it can do, in `runner.hello` and `runner.caps` (`runner-frames.ts`). */

/** The most runs a runner takes at once (`caps.slots`), and so the most live runs a heartbeat lists. */
export const RUNNER_SLOTS_MAX = 64;

/**
 * What a runner can do: the harnesses it has, its slots, how it holds its machine, the providers it can power, whether
 * it opens terminals, whether it updates itself, whether it browses its folders, the CLIs it found and its container.
 */
export const RunnerCaps = protocolObject({
  /**
   * Each harness's CLI version, null when it is missing (S5.1b); a runner older than chats lists the names alone and
   * runs no turn (`harnessVersionOf`).
   */
  harnesses: RunnerHarnesses,
  slots: z.int().min(0).max(RUNNER_SLOTS_MAX),
  hold: HoldDriver,
  /** Present when `airia` and `gcloud` are installed and signed in on this machine: it is a power controller. */
  power: z.array(PowerProvider).max(PowerProvider.options.length),
  /** True when its PTY loaded (`terminal.open` works); false from a runner older than the terminal. */
  terminal: z.boolean().default(false),
  /**
   * True for an installed copy its service manager restarts (launchd or systemd): it carries out `runner.update`. False
   * in a container, from the sources, and from a runner older than the self-update.
   */
  selfUpdate: z.boolean().default(false),
  /** True when it answers `fs.list` and `fs.mkdir` (S5.1d); false from a runner older than the folder browser. */
  folders: z.boolean().default(false),
  /** True when it answers `fs.mkdirp` (2026-11-13); false from an older runner, which the server tells to update. */
  mkdirp: z.boolean().default(false),
  /** True when its drivers fork a conversation for a branch (`TurnSpec.forkSession`); false from an older runner. */
  forks: z.boolean().default(false),
  /**
   * True when its turns outlive a dropped link and its own restart (S5.4, `reattach.ts`): the server keeps them waiting
   * for it instead of failing them. False from an older runner, which ends its turns when the link drops.
   */
  reattach: z.boolean().default(false),
  /**
   * True when its turns offer the agents' tools (S6a, `TurnSpec.tools`, `turn.tool`): the server then names them in a
   * turn's spec and writes the step's prompt for them. False from an older runner, whose agents move nothing.
   */
  agentTools: z.boolean().default(false),
  /**
   * The agents' tools its turns know by name (T-29): the server offers a turn only these, and tells the agent which of
   * its tools this runner is too old for instead of their dropping out unsaid. Left out by an older runner.
   */
  agentToolNames: z
    .array(z.string().regex(/^[a-z][a-z_]{0,63}$/))
    .max(128)
    .optional(),
  /** True when its turns offer `record_decision`, the decision log (2026-11-14); false from older ones, which lack it. */
  decisions: z.boolean().default(false),
  /** True when its turns list and relay the server's own tools (S7.1c, `TurnSpec.serverTools`); false from older ones. */
  serverTools: z.boolean().default(false),
  /** How many server tools a turn's spec may carry (S7.1e: 64); left out by older runners, which parse 32. */
  serverToolsMax: z.int().min(0).optional(),
  /** True when its turns put a GitHub sign-in in git's and gh's way (S7.1d, `TurnSpec.github`); false from older ones. */
  github: z.boolean().default(false),
  /**
   * True when its turns fetch a message's images and hand them to the harness (T-18, `TurnSpec.images`); false from
   * older ones, which the server tells to update before a message with images goes to them.
   */
  images: z.boolean().default(false),
  /**
   * The CLIs it found, each one's version or null (`tools.ts`); left out by a runner older than the tools, which knows
   * no `tools.check` or `tools.install` (its `harnesses` still say Claude Code's and Codex's).
   */
  tools: RunnerTools.optional(),
  /** Its container's id when it runs in a Docker container (the server rebuilds that one); left out elsewhere. */
  containerId: ContainerId.optional(),
});
export type RunnerCaps = z.infer<typeof RunnerCaps>;
