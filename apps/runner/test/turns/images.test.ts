import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import type { ChatImageRef } from '@mwc/shared/chat-images';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it, vi } from 'vitest';
import { fetchImages, type ImageFetch, imageFetcher, turnImages } from '../../src/turns/images.ts';
import { RunFolder } from '../../src/turns/runs/folder.ts';
import { tempDir } from '../fixtures/runner.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, startTurn, turnsWorld } from '../fixtures/turns.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 9]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const refOf = (bytes: Uint8Array, contentType: ChatImageRef['contentType']): ChatImageRef => ({
  id: newId(),
  contentType,
  size: bytes.length,
  sha256: sha256(bytes),
});

/** A fetch that answers each image's bytes by its id, and records the calls. */
function serverOf(images: ReadonlyMap<string, Uint8Array>, header = true) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    const bytes = images.get(url.split('/').at(-1) as string);
    if (bytes === undefined) return new Response('{}', { status: 404 });
    const headers: Record<string, string> = header ? { 'x-mwc-runner-sha256': sha256(bytes) } : {};
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  };
  return { fetch, calls };
}

describe('imageFetcher', () => {
  it("fetches an image of the turn from the runner's server with its key, checked against the spec", async () => {
    const ref = refOf(PNG, 'image/png');
    const server = serverOf(new Map([[ref.id, PNG]]));
    let key = 'mwc_rk_first';
    const fetch = imageFetcher({
      fetch: server.fetch,
      serverUrl: () => 'wss://mwc.example.test/',
      runnerKey: () => key,
    });
    expect(await fetch('turn-1', ref)).toEqual(PNG);
    key = 'mwc_rk_rotated';
    await fetch('turn-1', ref);
    expect(server.calls).toEqual([
      {
        url: `https://mwc.example.test/api/runner/turns/turn-1/images/${ref.id}`,
        authorization: 'Bearer mwc_rk_first',
      },
      { url: expect.any(String), authorization: 'Bearer mwc_rk_rotated' },
    ]);
  });

  it('throws for an answer that is not 200, bytes that differ from the spec, and a header that says another hash', async () => {
    const ref = refOf(PNG, 'image/png');
    const deps = { serverUrl: () => 'http://127.0.0.1:9950', runnerKey: () => 'k' };
    const missing = imageFetcher({ ...deps, fetch: serverOf(new Map()).fetch });
    await expect(missing('t', ref)).rejects.toThrow('the server answered 404');
    const other = imageFetcher({ ...deps, fetch: serverOf(new Map([[ref.id, GIF]])).fetch });
    await expect(other('t', ref)).rejects.toThrow('its bytes do not match the turn');
    const lying = imageFetcher({
      ...deps,
      fetch: async () =>
        new Response(new Uint8Array(PNG), { headers: { 'x-mwc-runner-sha256': sha256(GIF) } }),
    });
    await expect(lying('t', ref)).rejects.toThrow('its bytes do not match the turn');
    const quiet = imageFetcher({ ...deps, fetch: serverOf(new Map([[ref.id, PNG]]), false).fetch });
    expect(await quiet('t', ref)).toEqual(PNG);
  });
});

describe('fetchImages and turnImages', () => {
  it('fetches in order, or says which image failed and why; with no fetcher it refuses', async () => {
    const png = refOf(PNG, 'image/png');
    const gif = refOf(GIF, 'image/gif');
    const fetch: ImageFetch = async (_turnId, ref) => {
      if (ref.id === gif.id) throw new Error('timed out');
      return PNG;
    };
    expect(await fetchImages(fetch, 't', [png])).toEqual({ images: [{ ref: png, bytes: PNG }] });
    expect(await fetchImages(fetch, 't', [png, gif])).toEqual({
      refused: 'images_unavailable: image 2 could not be fetched (timed out)',
    });
    expect(await fetchImages(async () => Promise.reject('down'), 't', [png])).toEqual({
      refused: 'images_unavailable: image 1 could not be fetched (down)',
    });
    expect(await fetchImages(undefined, 't', [png])).toEqual({
      refused: 'images_unavailable: this runner cannot fetch images',
    });
  });

  it("names each image's file in the run folder and its base64, and writes them private once asked", () => {
    const dir = join(tempDir(), 'run');
    const none = turnImages(dir, []);
    expect(none.images).toBeUndefined();
    none.write();
    const png = refOf(PNG, 'image/png');
    const gif = refOf(GIF, 'image/gif');
    const made = turnImages(dir, [
      { ref: png, bytes: PNG },
      { ref: gif, bytes: GIF },
    ]);
    expect(made.images).toEqual([
      {
        contentType: 'image/png',
        base64: Buffer.from(PNG).toString('base64'),
        path: join(dir, 'images', '1.png'),
      },
      {
        contentType: 'image/gif',
        base64: Buffer.from(GIF).toString('base64'),
        path: join(dir, 'images', '2.gif'),
      },
    ]);
    mkdirSync(dir);
    made.write();
    expect(new Uint8Array(readFileSync(join(dir, 'images', '1.png')))).toEqual(PNG);
    expect(statSync(join(dir, 'images', '2.gif')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'images')).mode & 0o777).toBe(0o700);
  });
});

describe('a turn whose message has images (T-18)', () => {
  it('fetches them before the start and hands the driver their files in the run folder', async () => {
    const { host, driver, cwd } = fakeHarnessHost();
    const png = refOf(PNG, 'image/png');
    const fetched: string[] = [];
    const w = turnsWorld({
      host,
      images: async (turnId, ref) => {
        fetched.push(`${turnId}:${ref.id}`);
        return PNG;
      },
    });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines('a chart'), 0));
    const turnId = startTurn(w, fakeTurnSpec('claude_code', { cwd, images: [png] }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ turnId, ok: true });
    expect(fetched).toEqual([`${turnId}:${png.id}`]);
    const images = driver.images[0] ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      contentType: 'image/png',
      base64: Buffer.from(PNG).toString('base64'),
    });
    expect(images[0]?.path).toBe(join(RunFolder.dirOf(host.runs, turnId), 'images', '1.png'));
    expect(new Uint8Array(readFileSync(images[0]?.path as string))).toEqual(PNG);
  });

  it('refuses the turn when an image cannot be fetched, or when it has no way to fetch them, and runs nothing', async () => {
    const { host, cwd } = fakeHarnessHost();
    const spec = fakeTurnSpec('claude_code', { cwd, images: [refOf(PNG, 'image/png')] });
    const failing = turnsWorld({
      host,
      images: async () => Promise.reject(new Error('the server answered 404')),
    });
    const turnId = startTurn(failing, spec);
    await vi.waitFor(() => expect(failing.ends()).toHaveLength(1));
    expect(failing.ends()[0]).toEqual({
      type: 'turn.end',
      turnId,
      ok: false,
      exitCode: null,
      error: 'images_unavailable: image 1 could not be fetched (the server answered 404)',
    });
    expect(failing.spawn.calls).toEqual([]);
    const without = turnsWorld({ host });
    startTurn(without, spec);
    await vi.waitFor(() => expect(without.ends()).toHaveLength(1));
    expect(without.ends()[0]?.error).toBe('images_unavailable: this runner cannot fetch images');
  });

  it('does not start a turn stopped while its images are fetched, and fetches none for a missing harness', async () => {
    const { host, cwd } = fakeHarnessHost();
    const gate = Promise.withResolvers<Uint8Array>();
    const w = turnsWorld({ host, images: () => gate.promise });
    const turnId = startTurn(w, fakeTurnSpec('claude_code', { cwd, images: [refOf(PNG, 'image/png')] }));
    w.turns.handle({ type: 'turn.stop', turnId });
    gate.resolve(PNG);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ turnId, ok: false, error: 'stopped' });
    const asked: string[] = [];
    const codexless = turnsWorld({
      host,
      images: async (id) => {
        asked.push(id);
        return PNG;
      },
    });
    startTurn(codexless, fakeTurnSpec('codex', { cwd, images: [refOf(PNG, 'image/png')] }));
    await vi.waitFor(() => expect(codexless.ends()).toHaveLength(1));
    expect(codexless.ends()[0]?.error).toBe('unsupported');
    expect(asked).toEqual([]);
  });
});
