import type { HeldTurn, ResumedTurn } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { RunnerConnection } from '../connection.ts';
import { type Binding, sendFrame, type TurnAdopter, type TurnChannel } from './turn-types.ts';

/**
 * Taking turns back (S5.4, docs/runner-protocol.md "Surviving restarts"): a runner's hello names the turns it holds;
 * each is bound to its new connection (taken back from the chats module when this process has none). The board
 * (`turns.ts`) hands in its bindings and its `end` and `channelOf`, so this part never imports it back.
 */
export interface ResumeDeps {
  readonly bindings: Map<string, Binding>;
  /** Ends a waiting turn its runner came back without (`machine_disconnected: …`). */
  readonly lost: (binding: Binding) => void;
  /** The channel of a turn, which follows it from connection to connection. */
  readonly channelOf: (binding: Binding) => TurnChannel;
  /** Who builds the sink of a turn a restarted server takes back, when one was set. */
  readonly adopter: () => TurnAdopter | undefined;
  readonly logger: Logger | undefined;
}

/** Binds a turn to a connection that took it back: its grace ends, its sink hears it is back. */
function bind(binding: Binding, connection: RunnerConnection): void {
  clearTimeout(binding.grace);
  binding.grace = undefined;
  binding.connection = connection;
  binding.sink.detached?.(false);
}

/** The sink of a turn a restarted server takes back, asked of the chats module. */
async function adoptOne(
  deps: ResumeDeps,
  connection: RunnerConnection,
  turnId: string,
): Promise<Binding | undefined> {
  const { bindings, logger } = deps;
  const runner = { companyId: connection.runner.companyId, machineId: connection.machineId };
  const sink = await deps
    .adopter()?.(runner, turnId)
    .catch((error: unknown) => {
      logger?.error({ err: error, turnId }, 'could not take back a turn');
      return undefined;
    });
  if (sink === undefined || bindings.has(turnId)) return undefined;
  const binding: Binding = {
    turnId,
    companyId: connection.runner.companyId,
    machineId: connection.machineId,
    sink,
    connection,
    grace: undefined,
  };
  bindings.set(turnId, binding);
  sink.adopted?.(deps.channelOf(binding));
  return binding;
}

/**
 * A runner's hello (S5.4): each turn it holds is bound to its connection (taken back from the chats module when this
 * process has none, or no longer has it live: the chats module decides, `turnAdopter`) and `turn.resume` says where to
 * resume, null for a turn the server no longer has; a waiting turn of its machine it does not hold ends.
 */
export async function resume(
  deps: ResumeDeps,
  connection: RunnerConnection,
  held: readonly HeldTurn[],
): Promise<void> {
  const { bindings } = deps;
  const named = new Set(held.map((turn) => turn.turnId));
  for (const binding of [...bindings.values()]) {
    const waiting = binding.machineId === connection.machineId && binding.connection === undefined;
    if (waiting && !named.has(binding.turnId)) deps.lost(binding);
  }
  if (held.length === 0) return;
  const turns: ResumedTurn[] = [];
  for (const { turnId } of held) {
    const known = bindings.get(turnId);
    const binding =
      known === undefined
        ? await adoptOne(deps, connection, turnId)
        : known.machineId === connection.machineId
          ? known
          : undefined;
    if (binding === undefined) {
      turns.push({ turnId, lastSeq: null });
      continue;
    }
    bind(binding, connection);
    turns.push({ turnId, lastSeq: (await binding.sink.lastSeq?.()) ?? 0 });
  }
  sendFrame(connection, { type: 'turn.resume', turns });
}
