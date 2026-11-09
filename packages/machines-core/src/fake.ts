import { type DevboxSize, isTimeZone, type PowerProvider, type PowerStatus } from '@mwc/shared/machines';
import type { DiscoveredMachine, MachinePowerDriver, PowerReading, PowerRef } from './driver.ts';
import { MachinePowerError, type MachinePowerErrorCode } from './errors.ts';
import { type BoxRules, DEFAULT_BOX_RULES } from './rules.ts';

/** The driver's methods, as the fake records and fails them. */
export type FakePowerCall = 'discover' | 'status' | 'start' | 'stop' | 'setTimezone';

/** One call the fake received, in order (`calls`). */
export interface FakePowerCallRecord {
  readonly call: FakePowerCall;
  readonly instance?: string;
  readonly timezone?: string;
}

/** A box the fake holds. */
export interface FakeBoxInput {
  readonly ref: PowerRef;
  /** Defaults to `stopped`. */
  readonly status?: PowerStatus;
  readonly size?: DevboxSize;
  readonly hourlyCost?: number;
  /** Over the defaults (`DEFAULT_BOX_RULES`). */
  readonly rules?: Partial<BoxRules>;
}

/**
 * When a box that was started or stopped reaches `running` / `stopped`: at once (`immediately`), at the next
 * `status()` read (`next_status`, the default, as GCE with `--no-wait`), or only on `settle()` (`manual`).
 */
export type FakeSettleMode = 'immediately' | 'next_status' | 'manual';

export interface FakePowerDriverOptions {
  /** Defaults to `airia_devbox`. */
  readonly provider?: PowerProvider;
  readonly boxes?: readonly FakeBoxInput[];
  readonly settle?: FakeSettleMode;
}

interface FakeBox {
  ref: PowerRef;
  status: PowerStatus;
  size: DevboxSize | undefined;
  hourlyCost: number | undefined;
  rules: BoxRules;
  /** Statuses the next `status()` reads return, in turn (`script`). */
  script: PowerStatus[];
}

const SETTLED: Partial<Record<PowerStatus, PowerStatus>> = { starting: 'running', stopping: 'stopped' };

/**
 * An in-memory `MachinePowerDriver` for tests: boxes by instance name, starts and stops that settle as the
 * `settle` mode says, scripted status sequences (`script`), queued failures (`failNext`) and a record of every call
 * (`calls`). It never creates a box: starting a missing one rejects with `not_found`, as the real driver does.
 */
export class FakePowerDriver implements MachinePowerDriver {
  readonly provider: PowerProvider;
  readonly calls: FakePowerCallRecord[] = [];
  readonly #boxes = new Map<string, FakeBox>();
  readonly #failures: { call: FakePowerCall; error: MachinePowerError }[] = [];
  readonly #settle: FakeSettleMode;

  constructor(options: FakePowerDriverOptions = {}) {
    this.provider = options.provider ?? 'airia_devbox';
    this.#settle = options.settle ?? 'next_status';
    for (const box of options.boxes ?? []) this.addBox(box);
  }

  /** Adds a box, or replaces the one with its instance name. */
  addBox(input: FakeBoxInput): void {
    this.#boxes.set(input.ref.instance, {
      ref: { ...input.ref },
      status: input.status ?? 'stopped',
      size: input.size ?? input.ref.size,
      hourlyCost: input.hourlyCost,
      rules: { ...DEFAULT_BOX_RULES, ...input.rules },
      script: [],
    });
  }

  /** Removes a box: from now on it reads as `missing`. */
  removeBox(instance: string): void {
    this.#boxes.delete(instance);
  }

  /** The box's reading now, without settling it or recording a call; undefined when there is none. */
  box(instance: string): PowerReading | undefined {
    const box = this.#boxes.get(instance);
    return box === undefined ? undefined : reading(box);
  }

  /** Puts a box in a status, as if its provider changed it (the box's own idle stop, a stop from elsewhere). */
  setStatus(instance: string, status: PowerStatus): void {
    this.#need(instance).status = status;
  }

  /** The next `status()` reads of a box return these statuses in turn, each becoming the box's status. */
  script(instance: string, ...statuses: PowerStatus[]): void {
    this.#need(instance).script.push(...statuses);
  }

  /** Moves `starting` boxes to `running` and `stopping` ones to `stopped`: one box, or every box. */
  settle(instance?: string): void {
    const boxes = instance === undefined ? [...this.#boxes.values()] : [this.#need(instance)];
    for (const box of boxes) box.status = SETTLED[box.status] ?? box.status;
  }

  /** The next call of that kind rejects with a `MachinePowerError` of `code`; queued failures run in order. */
  failNext(call: FakePowerCall, code: MachinePowerErrorCode, message?: string): void {
    this.#failures.push({ call, error: new MachinePowerError(code, message) });
  }

  async discover(): Promise<DiscoveredMachine[]> {
    this.#enter({ call: 'discover' });
    return [...this.#boxes.values()].map((box) => ({ ref: { ...box.ref }, ...reading(box) }));
  }

  async status(ref: PowerRef): Promise<PowerReading> {
    this.#enter({ call: 'status', instance: ref.instance });
    const box = this.#boxes.get(ref.instance);
    if (box === undefined) return { status: 'missing', rules: null };
    const next = box.script.shift();
    if (next !== undefined) box.status = next;
    else if (this.#settle === 'next_status') this.settle(ref.instance);
    return reading(box);
  }

  async start(ref: PowerRef): Promise<PowerReading> {
    this.#enter({ call: 'start', instance: ref.instance });
    const box = this.#existing(ref);
    if (box.status === 'running' || box.status === 'starting') return { ...reading(box), already: true };
    box.status = this.#moving('starting');
    return reading(box);
  }

  async stop(ref: PowerRef): Promise<PowerReading> {
    this.#enter({ call: 'stop', instance: ref.instance });
    const box = this.#existing(ref);
    if (box.status === 'stopped' || box.status === 'stopping') return { ...reading(box), already: true };
    box.status = this.#moving('stopping');
    return reading(box);
  }

  async setTimezone(ref: PowerRef, timezone: string): Promise<PowerReading> {
    this.#enter({ call: 'setTimezone', instance: ref.instance, timezone });
    const box = this.#existing(ref);
    if (!isTimeZone(timezone)) throw new MachinePowerError('failed', `“${timezone}” is not a time zone.`);
    box.rules = { ...box.rules, timezone };
    return reading(box);
  }

  #enter(record: FakePowerCallRecord): void {
    this.calls.push(record);
    const failure = this.#failures.find((queued) => queued.call === record.call);
    if (failure === undefined) return;
    this.#failures.splice(this.#failures.indexOf(failure), 1);
    throw failure.error;
  }

  #moving(status: 'starting' | 'stopping'): PowerStatus {
    return this.#settle === 'immediately' ? (SETTLED[status] as PowerStatus) : status;
  }

  #existing(ref: PowerRef): FakeBox {
    const box = this.#boxes.get(ref.instance);
    if (box === undefined) throw new MachinePowerError('not_found', `There is no box named ${ref.instance}.`);
    return box;
  }

  #need(instance: string): FakeBox {
    const box = this.#boxes.get(instance);
    if (box === undefined) throw new Error(`FakePowerDriver: no box named ${instance}`);
    return box;
  }
}

function reading(box: FakeBox): PowerReading {
  return {
    status: box.status,
    ...(box.size === undefined ? {} : { size: box.size }),
    ...(box.hourlyCost === undefined ? {} : { hourlyCost: box.hourlyCost }),
    rules: box.status === 'missing' ? null : { ...box.rules },
  };
}
