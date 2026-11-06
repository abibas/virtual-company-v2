/** A frame of one type out of a union. */
export type FrameOf<F extends { readonly type: string }, T extends F['type']> = Extract<
  F,
  { readonly type: T }
>;

interface Waiter<F> {
  readonly find: () => number;
  readonly resolve: (frame: F) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Every frame one side of a fake received, in order, and a way to wait for them: `next(type)` hands out each frame
 * once, the oldest first, whether it already came or comes later, so a test reads the frames as a queue per type.
 */
export class FrameLog<F extends { readonly type: string }> {
  /** Every frame, in the order it came. */
  readonly all: F[] = [];
  readonly #taken = new Set<number>();
  #waiters: Waiter<F>[] = [];

  /** Records a frame and hands it to the oldest waiter it matches. */
  push(frame: F): void {
    this.all.push(frame);
    for (const waiter of this.#waiters) {
      const index = waiter.find();
      if (index === -1) continue;
      this.#take(waiter, index);
      return;
    }
  }

  /** Every frame of `type` so far, taken or not. */
  of<T extends F['type']>(type: T): FrameOf<F, T>[] {
    return this.all.filter((frame): frame is FrameOf<F, T> => frame.type === type);
  }

  /** The oldest frame of `type` (and `match`) not handed out yet; waits up to `timeoutMs` for one to come. */
  next<T extends F['type']>(
    type: T,
    match: (frame: FrameOf<F, T>) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<FrameOf<F, T>> {
    const find = () =>
      this.all.findIndex(
        (frame, index) => !this.#taken.has(index) && frame.type === type && match(frame as FrameOf<F, T>),
      );
    const index = find();
    if (index !== -1) {
      this.#taken.add(index);
      return Promise.resolve(this.all[index] as FrameOf<F, T>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter.timer !== timer);
        const seen = this.all.map((frame) => frame.type).join(', ') || 'none';
        reject(new Error(`No ${type} frame within ${timeoutMs} ms (frames so far: ${seen})`));
      }, timeoutMs);
      this.#waiters.push({ find, resolve: resolve as (frame: F) => void, timer });
    });
  }

  #take(waiter: Waiter<F>, index: number): void {
    clearTimeout(waiter.timer);
    this.#waiters = this.#waiters.filter((other) => other !== waiter);
    this.#taken.add(index);
    waiter.resolve(this.all[index] as F);
  }
}
