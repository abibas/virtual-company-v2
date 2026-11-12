import { disconnectedError, durationWords } from '@mwc/shared/chats';

/**
 * The words of a turn whose machine's runner went away for good (S5.4; worded since 2026-11-12, when "The machine
 * disconnected during the turn." told nothing of what happened), naming the machine, pure: the runner stayed away for
 * the whole grace; it came back without the turn; or it is too old to keep turns across a dropped link (its link's
 * close ended them).
 */

/** Why the hub takes a turn's runner to be gone for good. */
export type AwayWhy = 'grace' | 'lost' | 'old_runner';

/** The machine's name when it is not known (removed meanwhile). */
const SOME_MACHINE = 'The machine';

/** `machine_disconnected: <words>` for a turn of `machine` (its name) that ended because its runner went away. */
export function awayError(machine: string | undefined, why: AwayWhy, graceMs: number): string {
  const name = machine?.trim() || SOME_MACHINE;
  switch (why) {
    case 'grace':
      return disconnectedError(`${name} was unreachable for ${durationWords(graceMs)}: the turn stopped.`);
    case 'lost':
      return disconnectedError(
        `${name} came back without this turn: it stopped there while the link was down.`,
      );
    case 'old_runner':
      return disconnectedError(
        `${name} disconnected, and its runner is too old to keep a turn across a dropped link: the turn stopped. Update the runner on the Machines page.`,
      );
  }
}
