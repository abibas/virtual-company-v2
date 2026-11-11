import type { Log } from '../../system/log.ts';
import type { Timers } from '../../system/time.ts';
import { RUN_RETENTION_MS, RunFolder, type RunMeta } from './folder.ts';
import { connectKeeper, type Kept } from './kept.ts';

/**
 * The turns a runner finds on its disk when it starts (S5.4, docs/harness.md "Surviving restarts"): every run folder
 * with its meta, and its keeper when one answers on the folder's socket (the proof the process is still the turn's: a pid
 * alone may have been given to another process since, and the runner starts no `ps` to compare start times). A folder
 * without a meta (a start cut short) goes, and so does an ended turn's kept past `RUN_RETENTION_MS`.
 */

/** A run folder found at start: its meta, and its keeper when it still runs. */
export interface FoundRun {
  readonly folder: RunFolder;
  readonly meta: RunMeta;
  readonly kept: Kept | undefined;
}

export async function findRuns(
  root: string,
  deps: { timers: Timers; now: number; log: Log },
): Promise<FoundRun[]> {
  const found: FoundRun[] = [];
  for (const folder of RunFolder.list(root)) {
    const meta = folder.meta();
    if (meta === undefined) {
      deps.log.warn('a run folder without its meta; removed', { dir: folder.dir });
      folder.remove();
      continue;
    }
    const kept =
      folder.exit() === undefined ? await connectKeeper(folder.path('socket'), deps.timers) : undefined;
    if (kept === undefined && deps.now - folder.changedAt() > RUN_RETENTION_MS) {
      deps.log.info('an ended turn kept past its retention; removed', { turnId: meta.turnId });
      folder.remove();
      continue;
    }
    found.push({ folder, meta, kept });
  }
  return found;
}
