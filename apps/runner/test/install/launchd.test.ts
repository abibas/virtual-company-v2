import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchctlCommands, launchdManager, renderPlist } from '../../src/install/launchd.ts';
import { NODE, testHost } from '../fixtures/host.ts';

const SPEC = {
  node: '/Users/ihor/.nvm/versions/node/v24.21.0/bin/node',
  bundle: '/Users/ihor/.local/share/mwc-runner/runner.mjs',
  env: [
    ['PATH', '/Users/ihor/AIRIA CLI/bin:/usr/bin:/bin'],
    ['MWC_RUNNER_SERVICE', 'launchd'],
  ] as const,
  home: '/Users/ihor',
};

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mwc.runner</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/ihor/.nvm/versions/node/v24.21.0/bin/node</string>
    <string>/Users/ihor/.local/share/mwc-runner/runner.mjs</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/ihor/AIRIA CLI/bin:/usr/bin:/bin</string>
    <key>MWC_RUNNER_SERVICE</key>
    <string>launchd</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/ihor</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/Users/ihor/.local/state/mwc-runner/runner.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ihor/.local/state/mwc-runner/runner.log</string>
</dict>
</plist>
`;

describe('the launchd agent', () => {
  it('runs `node <bundle> run` at load, restarts it when it fails (10 s apart) and logs in the state folder', () => {
    expect(renderPlist(SPEC, '/Users/ihor/.local/state/mwc-runner/runner.log')).toBe(PLIST);
  });

  it('escapes what XML would read', () => {
    const plist = renderPlist({ ...SPEC, home: `/Users/a&b <"x'>` }, '/tmp/log');
    expect(plist).toContain('<string>/Users/a&amp;b &lt;&quot;x&apos;&gt;</string>');
  });

  it("loads into the user's GUI session and unloads by label", () => {
    expect(launchctlCommands(501, '/p.plist')).toEqual({
      bootstrap: ['/bin/launchctl', ['bootstrap', 'gui/501', '/p.plist']],
      bootout: ['/bin/launchctl', ['bootout', 'gui/501/com.mwc.runner']],
    });
  });
});

describe('installing and removing the launchd agent', () => {
  it('writes the plist (0644) and bootstraps it; a reinstall boots the old one out first', async () => {
    const { host, home, execs } = testHost({ platform: 'darwin' });
    const manager = launchdManager(host);
    const plist = join(home, 'Library/LaunchAgents/com.mwc.runner.plist');
    const log = join(home, '.local/state/mwc-runner/runner.log');
    expect(manager).toMatchObject({ name: 'launchd agent', file: plist, logs: `tail -f ${log}` });
    expect(await manager.install()).toEqual([]);
    expect(statSync(plist).mode & 0o777).toBe(0o644);
    expect(statSync(join(home, '.local/state/mwc-runner')).mode & 0o777).toBe(0o700);
    const text = readFileSync(plist, 'utf8');
    expect(text).toContain(`<string>${NODE}</string>`);
    expect(text).toContain('<key>MWC_RUNNER_SERVICE</key>\n    <string>launchd</string>');
    expect(text).toContain(`<string>${log}</string>`);
    expect(execs.map((call) => call.args[0])).toEqual(['bootstrap']);
    await manager.install();
    expect(execs.map((call) => call.args[0])).toEqual(['bootstrap', 'bootout', 'bootstrap']);
  });

  it('tries the bootstrap three times, a second apart, then says to install from the desktop session', async () => {
    let bootstraps = 0;
    const { host, execs, sleeps } = testHost({
      platform: 'darwin',
      exec: (_file, args) => {
        if (args[0] !== 'bootstrap') return undefined;
        bootstraps += 1;
        return bootstraps === 2
          ? undefined
          : { code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' };
      },
    });
    await launchdManager(host).install();
    expect(execs.map((call) => call.args[0])).toEqual(['bootstrap', 'bootout', 'bootstrap']);
    expect(sleeps).toEqual([1000]);
    bootstraps = 2;
    await expect(launchdManager(host).install()).rejects.toThrow(
      /could not load .*com\.mwc\.runner\.plist into your login session \(gui\/501\): Bootstrap failed: 5: Input\/output error\. Run the install from a Terminal/,
    );
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it('boots the agent out and removes the plist; nothing installed is fine', async () => {
    const { host, execs } = testHost({ platform: 'darwin' });
    const manager = launchdManager(host);
    await manager.remove();
    expect(execs).toEqual([]);
    await manager.install();
    await manager.remove();
    expect(host.fs.exists(manager.file)).toBe(false);
    expect(execs.at(-1)?.args).toEqual(['bootout', 'gui/501/com.mwc.runner']);
  });
});
