import { runnerConfigPath, runnerStateDir } from '../config.ts';
import { type Host, homeOf } from './host.ts';
import { runnerDataDir } from './paths.ts';
import { serviceManager } from './service.ts';

/**
 * `mwc-runner uninstall [--purge]`: stops and removes the service and the installed runner. The configuration (the
 * runner key) stays unless `--purge`, which also removes it and the state folder; the machine stays on the server
 * until it is removed on the Machines page.
 */
export async function uninstallCommand(
  host: Host,
  input: { readonly purge?: boolean | undefined },
): Promise<number> {
  const manager = serviceManager(host);
  const installed = host.fs.exists(manager.file);
  await manager.remove();
  const dataDir = runnerDataDir(host.env, homeOf(host));
  host.fs.remove(dataDir);
  host.out(
    installed
      ? `Stopped and removed the ${manager.name} (${manager.file}) and the installed runner (${dataDir}).\n`
      : `No ${manager.name} was installed; removed ${dataDir}.\n`,
  );
  const configPath = runnerConfigPath(host.env);
  if (input.purge) {
    const stateDir = runnerStateDir(host.env);
    host.fs.remove(configPath);
    host.fs.remove(stateDir);
    host.out(
      `Removed the configuration with the runner key (${configPath}) and the state folder (${stateDir}).\n`,
    );
  } else {
    host.out(`Kept the enrollment in ${configPath}; uninstall --purge removes it too.\n`);
  }
  host.out('The machine stays on the server until you remove it on the Machines page.\n');
  return 0;
}
