import { afterAll, beforeAll, describe, it } from 'vitest';
import { CONVERGENCE_CASES } from './store-contract/convergence.ts';
import { PORT_CASES } from './store-contract/port.ts';
import { RECONCILE_CASES } from './store-contract/reconcile.ts';
import type {
  StoreContractCase,
  StoreContractSettings,
  StoreContractTarget,
} from './store-contract/target.ts';

export { memorySeedableStore, memoryStoreTarget } from './store-contract/memory-target.ts';
export type {
  IdentitySnapshot,
  SeedableStore,
  StoreContractCase,
  StoreContractSettings,
  StoreContractTarget,
} from './store-contract/target.ts';

/**
 * The `IdentityStore` contract (docs/testing.md, "Store contract"): what every store passes in the same way.
 * The port's behaviour method by method; the projector's convergence on the store (the identity scenario in
 * order, shuffled, delivered twice, repeated, one person's history in many orders), ending where the
 * in-memory reference store ends; and reconcile giving what the webhooks give. Each case starts from
 * `target.fresh()`, so the cases are independent.
 */
export const STORE_CONTRACT: readonly StoreContractCase[] = [
  ...PORT_CASES,
  ...CONVERGENCE_CASES,
  ...RECONCILE_CASES,
];

/** The full counts, for the in-memory store; a database target passes fewer. */
export const FULL_SETTINGS: StoreContractSettings = { shuffles: 200, doubles: 25, orders: 720 };

export interface StoreContractOptions extends Partial<StoreContractSettings> {
  /** Per case, and for the target's setup and cleanup. */
  readonly timeoutMs?: number;
}

/**
 * Registers the contract as a Vitest suite for one target: `makeTarget` runs before the first case and
 * the target's `cleanup` after the last, also when a case failed.
 */
export function describeStoreContract(
  name: string,
  makeTarget: () => StoreContractTarget | Promise<StoreContractTarget>,
  options: StoreContractOptions = {},
): void {
  const { timeoutMs = 30_000, ...counts } = options;
  const settings: StoreContractSettings = { ...FULL_SETTINGS, ...counts };
  describe(`IdentityStore contract: ${name}`, () => {
    const targets: StoreContractTarget[] = [];
    beforeAll(async () => {
      targets.push(await makeTarget());
    }, timeoutMs);
    afterAll(async () => {
      for (const target of targets) await target.cleanup();
    }, timeoutMs);
    for (const contractCase of STORE_CONTRACT) {
      it(
        contractCase.name,
        // When the setup fails, Vitest fails the cases without running them: a target is always there here.
        () => contractCase.run(targets[0] as StoreContractTarget, settings),
        timeoutMs,
      );
    }
  });
}
