import { describe, expect, it } from 'vitest';
import {
  containerCommand,
  containerServerUrl,
  DEVBOX_HINT,
  devboxCommand,
  enrollTokenText,
  installCommand,
  isLoopback,
  portOf,
} from '../../src/machines/render.ts';

const TOKEN = `mwc_et_${'Ab12'.repeat(8)}`;
const PUBLIC = 'https://corp.example.com';

describe('the install commands', () => {
  it('pipes the installer into sh with the server and the token', () => {
    expect(installCommand('http://localhost:9950', TOKEN)).toBe(
      `curl -fsSL http://localhost:9950/api/runner/install.sh | sh -s -- --server http://localhost:9950 --token ${TOKEN}`,
    );
  });

  it("runs it on the Airia devbox through airia devbox ssh, the box's port forwarded back to the API, quoted as one command", () => {
    expect(devboxCommand(9950, TOKEN)).toBe(
      `airia devbox ssh -- -R 127.0.0.1:9950:127.0.0.1:9950 'curl -fsSL http://127.0.0.1:9950/api/runner/install.sh | sh -s -- --server http://127.0.0.1:9950 --token ${TOKEN}'`,
    );
    expect(devboxCommand(9963, TOKEN)).toContain(
      "-R 127.0.0.1:9963:127.0.0.1:9963 'curl -fsSL http://127.0.0.1:9963/api/runner/install.sh",
    );
  });

  it('reads the port of an address, its protocol default without one', () => {
    expect(portOf('http://localhost:9950')).toBe(9950);
    expect(portOf('http://127.0.0.1:9963/')).toBe(9963);
    expect(portOf(PUBLIC)).toBe(443);
    expect(portOf('http://corp.example.com')).toBe(80);
  });

  it('knows the addresses only this machine reaches', () => {
    for (const url of [
      'http://localhost:9950',
      'http://127.0.0.1:9960',
      'http://[::1]:9950',
      'http://0.0.0.0:1',
    ]) {
      expect(isLoopback(url), url).toBe(true);
    }
    expect(isLoopback(PUBLIC)).toBe(false);
  });

  it('starts the compose runner, telling it the server only when the default does not reach it', () => {
    expect(containerServerUrl('http://localhost:9950')).toBe('http://host.docker.internal:9950');
    expect(containerServerUrl('http://127.0.0.1:9960/')).toBe('http://host.docker.internal:9960');
    expect(containerServerUrl(PUBLIC)).toBe(PUBLIC);
    const compose = 'docker compose -f deploy/compose.yml --profile runner up -d runner-local';
    expect(containerCommand('http://localhost:9950', TOKEN)).toBe(`MWC_ENROLL_TOKEN=${TOKEN} ${compose}`);
    expect(containerCommand('http://localhost:9963', TOKEN)).toBe(
      `MWC_SERVER_URL=http://host.docker.internal:9963 MWC_ENROLL_TOKEN=${TOKEN} ${compose}`,
    );
    expect(containerCommand(PUBLIC, TOKEN)).toBe(
      `MWC_SERVER_URL=${PUBLIC} MWC_ENROLL_TOKEN=${TOKEN} ${compose}`,
    );
  });
});

describe('what mwc machine enroll-token prints', () => {
  const base = {
    company: { name: 'Acme', slug: 'acme' },
    token: TOKEN,
    expiresAt: '2026-11-06T13:00:00.000Z',
    server: 'http://localhost:9950',
  };

  it("is the token and the command for This Mac, the devbox (on the API's port) and a container", () => {
    expect(enrollTokenText({ ...base, apiUrl: 'http://localhost:9963' })).toBe(
      [
        'An enrollment token for Acme (acme), good for one machine until 2026-11-06T13:00:00.000Z:',
        '',
        `  ${TOKEN}`,
        '',
        'Run one of these to install a runner with it (one token enrolls one machine; make another for the next):',
        '',
        'This Mac:',
        `  ${installCommand('http://localhost:9950', TOKEN)}`,
        '',
        "The Airia devbox (run it on This Mac, after This Mac's runner is installed: that runner keeps the box connected afterwards; it starts the box if it is stopped, and the box costs its hourly rate while it is up):",
        `  ${devboxCommand(9963, TOKEN)}`,
        '',
        'A Docker container on This Mac (from the repository folder):',
        `  ${containerCommand('http://localhost:9950', TOKEN)}`,
        '',
      ].join('\n'),
    );
  });

  it("takes the port of the server it talks to when the API's own address is not known", () => {
    const text = enrollTokenText({ ...base, apiUrl: null });
    expect(text).toContain(`${DEVBOX_HINT}\n  ${devboxCommand(9950, TOKEN)}\n`);
    expect(text).not.toContain('MWC_PUBLIC_URL');
  });
});
