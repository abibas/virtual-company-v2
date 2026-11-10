import { dirname, join } from 'node:path';
import { machineKind } from '../install/enroll/facts.ts';
import { type Env, type Host, homeOf } from '../install/host.ts';
import { type FoundTools, findTools } from './find.ts';

/**
 * What the daemon's tools need from the machine (`cli.ts` makes it from the real host, `tools.ts` uses it): the search,
 * the npm an install runs, the home it installs under, the environment, and whether this is a container.
 */
export interface ToolsHost {
  /** Looks for every CLI again and asks each one found its version (`find.ts`); it never throws. */
  find(): Promise<FoundTools>;
  /** The npm beside the runner's own Node (`<its folder>/npm`), undefined when there is none. */
  npm(): string | undefined;
  /** The runner user's home: CLIs install under `<home>/.local`, their commands in `<home>/.local/bin`. */
  readonly home: string;
  /** The runner's environment, which npm gets with its folder first on the PATH. */
  readonly env: Env;
  /** A container gets its CLIs from its image, rebuilt instead: nothing is installed in one. */
  readonly container: boolean;
}

/** The tools host of this machine. */
export function toolsHost(host: Host): ToolsHost {
  const npm = join(dirname(host.execPath), 'npm');
  return {
    find: () => findTools(host),
    npm: () => (host.fs.isExecutable(npm) ? npm : undefined),
    home: homeOf(host),
    env: host.env,
    container: machineKind(host) === 'container',
  };
}
