import { CommandError, type Host } from './host.ts';
import { launchdManager } from './launchd.ts';
import { systemdManager } from './systemd.ts';

/**
 * The service that keeps the runner running: a launchd agent on macOS (`launchd.ts`), a systemd user unit with
 * lingering on Linux (`systemd.ts`). A container needs neither: the runner is its main process
 * (`deploy/Dockerfile.runner`).
 */
export interface ServiceManager {
  /** `launchd agent` or `systemd user unit`. */
  readonly name: string;
  /** The service file: the plist or the unit. */
  readonly file: string;
  /** How to follow the runner's log. */
  readonly logs: string;
  /** Writes the service file and (re)starts the service; returns warnings to show. Throws a CommandError. */
  install(): Promise<string[]>;
  /** Stops the service, unloads it and removes its file; nothing installed is fine. */
  remove(): Promise<void>;
}

/** This machine's service manager; a CommandError on a system without one the runner knows. */
export function serviceManager(host: Host): ServiceManager {
  if (host.platform === 'darwin') return launchdManager(host);
  if (host.platform === 'linux') return systemdManager(host);
  throw new CommandError(`the runner installs as a service on macOS and Linux, not on ${host.platform}`);
}
