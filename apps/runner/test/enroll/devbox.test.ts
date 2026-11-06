import { describe, expect, it } from 'vitest';
import { detectProvider, METADATA_BASE, NO_PROVIDER } from '../../src/enroll/devbox.ts';
import { DEVBOX_KEEPALIVE_BIN } from '../../src/hold/driver.ts';
import { type Fetch, noFetch, testHost } from '../fixtures/host.ts';

const ANSWERS: Record<string, string> = {
  'instance/name': 'dev-ihorherasko\n',
  'instance/zone': 'projects/123456789/zones/europe-west1-b',
  'project/project-id': 'airia-devbox',
};

/** The GCE metadata server: what `answers` has, with the Metadata-Flavor header only. */
function metadataServer(answers: Record<string, string> = ANSWERS) {
  const asked: { url: string; flavor: string | null; signal: boolean }[] = [];
  const fetch: Fetch = async (url, init) => {
    const flavor = new Headers(init?.headers).get('metadata-flavor');
    asked.push({ url, flavor, signal: init?.signal instanceof AbortSignal });
    const path = url.slice(METADATA_BASE.length);
    if (flavor !== 'Google' || answers[path] === undefined) return new Response('', { status: 404 });
    return new Response(answers[path]);
  };
  return { fetch, asked };
}

describe('the Airia devbox', () => {
  it('is a machine with devbox-keepalive whose metadata server names its instance, zone and project', async () => {
    const server = metadataServer();
    const { host } = testHost({ files: [DEVBOX_KEEPALIVE_BIN], fetch: server.fetch });
    expect(await detectProvider(host)).toEqual({
      provider: 'airia_devbox',
      providerRef: { instance: 'dev-ihorherasko', zone: 'europe-west1-b', project: 'airia-devbox' },
    });
    expect(server.asked.map((call) => call.url).sort()).toEqual([
      'http://metadata.google.internal/computeMetadata/v1/instance/name',
      'http://metadata.google.internal/computeMetadata/v1/instance/zone',
      'http://metadata.google.internal/computeMetadata/v1/project/project-id',
    ]);
    expect(server.asked.every((call) => call.flavor === 'Google' && call.signal)).toBe(true);
  });

  it('is not asked for on a machine without the keepalive', async () => {
    expect(await detectProvider(testHost({ fetch: noFetch }).host)).toEqual(NO_PROVIDER);
  });

  it('is no devbox when the metadata server is missing, slow or silent about a value', async () => {
    const unreachable = testHost({ files: [DEVBOX_KEEPALIVE_BIN] });
    expect(await detectProvider(unreachable.host)).toEqual(NO_PROVIDER);
    const { 'project/project-id': _, ...partial } = ANSWERS;
    const silent = testHost({ files: [DEVBOX_KEEPALIVE_BIN], fetch: metadataServer(partial).fetch });
    expect(await detectProvider(silent.host)).toEqual(NO_PROVIDER);
    const blank = testHost({
      files: [DEVBOX_KEEPALIVE_BIN],
      fetch: metadataServer({ ...ANSWERS, 'instance/name': ' ' }).fetch,
    });
    expect(await detectProvider(blank.host)).toEqual(NO_PROVIDER);
  });
});
