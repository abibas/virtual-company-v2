// @mwc/machines-core: the machine power port (docs/machines.md). The test double is a separate import:
// @mwc/machines-core/fake (FakePowerDriver).
export type { DiscoveredMachine, MachinePowerDriver, PowerReading, PowerRef } from './driver.ts';
export {
  isMachinePowerError,
  MACHINE_POWER_ERROR_CODES,
  MACHINE_POWER_ERROR_MESSAGES,
  MachinePowerError,
  type MachinePowerErrorCode,
  type MachinePowerErrorOptions,
} from './errors.ts';
export {
  BOX_RULE_KEYS,
  type BoxRules,
  boxRulesFromMetadata,
  DEFAULT_BOX_RULES,
  type MetadataItem,
} from './rules.ts';
