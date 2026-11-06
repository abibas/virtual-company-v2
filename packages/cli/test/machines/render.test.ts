import { describe, expect, it } from 'vitest';
import {
  containerCommand,
  containerServerUrl,
  devboxCommand,
  enrollTokenText,
  installCommand,
  isLoopback,
} from '../../src/machines/render.ts';

const TOKEN = `mwc_et_${'Ab12'.repeat(8)}`;
const NGROK = 'https://corp-mwc.ngrok.app';

describe('the install commands', () => {
  it('pipes the installer into sh with the server and the token', () => {
    expect(installCommand('http://localhost:9950', TOKEN)).toBe(
      `curl -fsSL http://localhost:9950/api/runner/install.sh | sh -s -- --server http://localhost:9950 --token ${TOKEN}`,
    );
  });

  it('runs it on the Airia devbox through airia devbox ssh, quoted as one command', () => {
    expect(devboxCommand(NGROK, TOKEN)).toBe(
      `airia devbox ssh -- 'curl -fsSL ${NGROK}/api/runner/install.sh | sh -s -- --server ${NGROK} --token ${TOKEN}'`,
    );
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
    expect(isLoopback(NGROK)).toBe(false);
  });

  it('starts the compose runner, telling it the server only when the default does not reach it', () => {
    expect(containerServerUrl('http://localhost:9950')).toBe('http://host.docker.internal:9950');
    expect(containerServerUrl('http://127.0.0.1:9960/')).toBe('http://host.docker.internal:9960');
    expect(containerServerUrl(NGROK)).toBe(NGROK);
    const compose = 'docker compose -f deploy/compose.yml --profile runner up -d runner-local';
    expect(containerCommand('http://localhost:9950', TOKEN)).toBe(`MWC_ENROLL_TOKEN=${TOKEN} ${compose}`);
    expect(containerCommand('http://localhost:9963', TOKEN)).toBe(
      `MWC_SERVER_URL=http://host.docker.internal:9963 MWC_ENROLL_TOKEN=${TOKEN} ${compose}`,
    );
    expect(containerCommand(NGROK, TOKEN)).toBe(
      `MWC_SERVER_URL=${NGROK} MWC_ENROLL_TOKEN=${TOKEN} ${compose}`,
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

  it('is the token and the command for This Mac, the devbox (at the public address) and a container', () => {
    expect(enrollTokenText({ ...base, publicUrl: NGROK })).toBe(
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
        'The Airia devbox (you run it on This Mac; the box reaches the server at its public address):',
        `  ${devboxCommand(NGROK, TOKEN)}`,
        '',
        'A Docker container on This Mac (from the repository folder):',
        `  ${containerCommand('http://localhost:9950', TOKEN)}`,
        '',
      ].join('\n'),
    );
  });

  it('says the devbox needs MWC_PUBLIC_URL when the server has none, or only a local one', () => {
    for (const publicUrl of [null, 'http://localhost:9950']) {
      const text = enrollTokenText({ ...base, publicUrl });
      expect(text).toContain(
        'Set MWC_PUBLIC_URL to it (the ngrok static domain), restart the server, and run:',
      );
      expect(text).toContain(devboxCommand('https://<your public address>', TOKEN));
    }
  });
});
