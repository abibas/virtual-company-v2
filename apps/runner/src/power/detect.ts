import { type LocalDevboxDeps, localDevbox } from '@mwc/machine-airia-devbox';
import { NO_POWER, type PowerExecutor } from '../power.ts';
import { driverExecutor } from './airia-devbox.ts';

/**
 * Whether this machine is a power controller (S4.4b): it is when both the airia CLI and gcloud are installed, found
 * on the PATH or in the usual folders without starting a process (`localDevbox` of the connector, which the server
 * uses the same way). Then its runner announces `caps.power: ['airia_devbox']`, carries out `power.command`s with the
 * Airia devbox driver and holds each powered box's reverse tunnel with gcloud. Whether gcloud is signed in shows on the
 * first command (`needs_gcloud_login`).
 */

export type DetectDeps = LocalDevboxDeps;

/** The power executor of this machine: the Airia devbox's when `airia` and `gcloud` are both found, else `NO_POWER`. */
export function detectPowerExecutor(deps: DetectDeps): PowerExecutor {
  const found = localDevbox(deps);
  return found.ok ? driverExecutor(found.driver) : NO_POWER;
}
