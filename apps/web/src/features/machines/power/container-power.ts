import { useState } from 'react';
import { ApiError, friendlyMessage } from '../../../api/errors.ts';
import type { PowerControl } from '../../../api/machines.ts';
import type { ContainerPower, MachineLive } from '../../../api/types.ts';

/**
 * A container runner's Start and Stop (docs/machines.md, "Starting and stopping a container"): which one its card
 * offers, how its power reads, and the action's state (busy while Docker works, the refusal with the command to run).
 */

export type ContainerAction = 'start' | 'stop';

/** Stop while the container runs or comes up, else Start. */
export const actionOf = (container: Pick<ContainerPower, 'status'>): ContainerAction =>
  container.status === 'running' || container.status === 'starting' ? 'stop' : 'start';

/** Who starts and stops it, in one line. */
export const containerLine = (container: Pick<ContainerPower, 'docker'>): string =>
  container.docker
    ? 'Started and stopped by this server with Docker'
    : 'This server has no Docker of its own (MWC_LOCAL_DOCKER): Start and Stop show the command to run';

const counted = (n: number, one: string) => (n > 0 ? [`${n} ${one}${n === 1 ? '' : 's'}`] : []);

/** The question before a Stop that ends live work ("1 chat turn is running on it…"); undefined without any. */
export function stopQuestion(live: MachineLive | undefined): string | undefined {
  if (live === undefined) return undefined;
  const parts = [...counted(live.turns, 'chat turn'), ...counted(live.terminals, 'terminal')];
  if (parts.length === 0) return undefined;
  const one = live.turns + live.terminals === 1;
  return `${parts.join(' and ')} ${one ? 'is' : 'are'} running on it and ${one ? 'ends' : 'end'} with the stop. Stop it anyway?`;
}

/** A refused or failed Start or Stop: why, and the command to run instead when the server names one. */
export interface ContainerFailure {
  readonly message: string;
  readonly command: string | undefined;
}

export interface ContainerActions {
  readonly busy: ContainerAction | undefined;
  readonly failure: ContainerFailure | undefined;
  run(action: ContainerAction, force?: boolean): void;
  dismiss(): void;
}

/** Runs a Start or Stop: busy while Docker works (a Stop waits for the runner's shutdown), then its refusal. */
export function useContainerActions(control: PowerControl): ContainerActions {
  const [busy, setBusy] = useState<ContainerAction>();
  const [failure, setFailure] = useState<ContainerFailure>();
  const run = async (action: ContainerAction, force: boolean) => {
    setBusy(action);
    setFailure(undefined);
    try {
      await (action === 'start' ? control.start() : control.stop(force));
    } catch (error) {
      const command = error instanceof ApiError ? error.command : undefined;
      setFailure({ message: friendlyMessage(error), command });
    } finally {
      setBusy(undefined);
    }
  };
  return {
    busy,
    failure,
    run: (action, force = false) => void run(action, force),
    dismiss: () => setFailure(undefined),
  };
}
