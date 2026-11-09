import {
  createTestApp,
  FakeIdentityProvider,
  fixedClock,
  getJson,
  seedApiKey,
  seedCompany,
  type TestApp,
} from '@mwc/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SpeechText } from '../../../src/platform/processes/speech/transcript.ts';
import { SPEECH_MAX_BYTES } from '../../../src/platform/processes/speech/wav.ts';
import { type Speech, SpeechError } from '../../../src/platform/processes/speech/whisper.ts';
import { addUser, type LinkedUser } from '../../fixtures/companies/companies.ts';
import { bearer } from '../../fixtures/platform/auth.ts';
import { wavClip } from '../../fixtures/speech/clips.ts';

const TRANSCRIBE = '/api/me/speech/transcribe';
const HEARD: SpeechText = { text: 'Hello there.', words: [{ text: 'Hello', start: 120, end: 500 }] };

/** A speech engine that records the clips it was given and answers `next` (a text, or a refusal to throw). */
class FakeSpeech implements Speech {
  readonly clips: Uint8Array[] = [];
  next: SpeechText | SpeechError = HEARD;
  closed = 0;

  async transcribe(wav: Uint8Array): Promise<SpeechText> {
    this.clips.push(wav);
    if (this.next instanceof SpeechError) throw this.next;
    return this.next;
  }

  async close(): Promise<void> {
    this.closed++;
  }
}

const speech = new FakeSpeech();
const stops: (() => Promise<void>)[] = [];
let t: TestApp;
let ihor: LinkedUser;
let apiKey: string;

beforeAll(async () => {
  const clock = fixedClock();
  const fake = new FakeIdentityProvider({ clock });
  const onShutdown = (stop: () => Promise<void>) => void stops.push(stop);
  t = await createTestApp({ clock, identity: fake, speech, onShutdown });
  ihor = await addUser(t.db, fake);
  const seeded = await seedCompany(t.db);
  apiKey = (await seedApiKey(t.db, seeded.company.id, seeded.owner.principal.id)).key;
  fake.createUser({ subject: 'speech_unlinked', email: 'unlinked@speech.test' });
});
afterAll(() => t.close());
beforeEach(() => {
  speech.clips.length = 0;
  speech.next = HEARD;
});

function post(
  app: TestApp['app'],
  token: string | undefined,
  body: Uint8Array<ArrayBuffer> | string,
  type = 'audio/wav',
) {
  const headers: Record<string, string> = { 'content-type': type, ...(token ? bearer(token) : {}) };
  return app.request(TRANSCRIBE, { method: 'POST', headers, body });
}

const errorOf = async (res: Response) => ({
  status: res.status,
  code: ((await res.json()) as { error: { code: string } }).error.code,
});

describe('POST /api/me/speech/transcribe', () => {
  it("transcribes a signed-in person's clip with the server's speech engine", async () => {
    const clip = wavClip(1_000);
    const res = await post(t.app, ihor.token, clip);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(HEARD);
    expect(speech.clips).toHaveLength(1);
    expect(speech.clips[0]?.length).toBe(clip.length);
  });

  it('takes a personal API key too, and the audio/x-wav and audio/wave types', async () => {
    expect((await post(t.app, apiKey, wavClip(500), 'audio/x-wav')).status).toBe(200);
    expect((await post(t.app, apiKey, wavClip(500), 'audio/wave; codecs=1')).status).toBe(200);
  });

  it('keeps nothing of the clip: the bytes it read are zeroed once answered, and nothing is logged of it', async () => {
    speech.next = { text: 'secret words', words: [] };
    await post(t.app, ihor.token, wavClip(1_000));
    expect(speech.clips[0]?.every((byte) => byte === 0)).toBe(true);
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain('RIFF');
    expect(logged).not.toContain('secret words');
  });

  it('refuses no credential (401), a person not linked yet (403) and a body that is not audio/wav (415)', async () => {
    expect(await errorOf(await post(t.app, undefined, wavClip(100)))).toEqual({
      status: 401,
      code: 'unauthenticated',
    });
    expect(await errorOf(await post(t.app, 'fake:speech_unlinked', wavClip(100)))).toEqual({
      status: 403,
      code: 'user_not_linked',
    });
    expect(await errorOf(await post(t.app, ihor.token, '{}', 'application/json'))).toEqual({
      status: 415,
      code: 'unsupported_media_type',
    });
    expect(speech.clips).toEqual([]);
  });

  it('answers 413 past 8 MB without handing it on, and for a clip over two minutes', async () => {
    const huge = new Uint8Array(SPEECH_MAX_BYTES + 1);
    expect(await errorOf(await post(t.app, ihor.token, huge))).toEqual({
      status: 413,
      code: 'audio_too_large',
    });
    expect(speech.clips).toEqual([]);
    speech.next = new SpeechError('too_long', 'A clip is at most two minutes long');
    expect(await errorOf(await post(t.app, ihor.token, wavClip(100)))).toEqual({
      status: 413,
      code: 'audio_too_large',
    });
  });

  it('answers 422 for a body that is not a 16 kHz mono WAV, and 502 when whisper.cpp fails', async () => {
    speech.next = new SpeechError('not_wav', 'Send a 16 kHz mono 16-bit PCM WAV');
    expect(await errorOf(await post(t.app, ihor.token, wavClip(100)))).toEqual({
      status: 422,
      code: 'invalid_audio',
    });
    speech.next = new SpeechError('failed', 'whisper.cpp could not transcribe the clip');
    expect(await errorOf(await post(t.app, ihor.token, wavClip(100)))).toEqual({
      status: 502,
      code: 'speech_failed',
    });
  });

  it('lets an unexpected failure through as a 500 without its details', async () => {
    const broken: Speech = {
      transcribe: () => Promise.reject(new Error('disk /secret full')),
      close: async () => {},
    };
    const fake = new FakeIdentityProvider({ clock: fixedClock() });
    const other = await createTestApp({ identity: fake, speech: broken });
    const person = await addUser(other.db, fake);
    const res = await post(other.app, person.token, wavClip(100));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('/secret');
    await other.close();
  });

  it('stops the speech engine when the server shuts down', async () => {
    await Promise.all(stops.map((stop) => stop()));
    expect(speech.closed).toBe(1);
  });
});

describe('dictation off', () => {
  it('answers 503 speech_unavailable before reading the clip, and /api/config says speech: false', async () => {
    const fake = new FakeIdentityProvider({ clock: fixedClock() });
    const off = await createTestApp({ identity: fake, speech: undefined });
    const person = await addUser(off.db, fake);
    expect(await errorOf(await post(off.app, person.token, wavClip(100)))).toEqual({
      status: 503,
      code: 'speech_unavailable',
    });
    expect((await getJson(off.app, '/api/config')).body).toMatchObject({ speech: false });
    await off.close();
  });

  it('is what a test app gets by default (MWC_WHISPER is never looked for in tests), and on with an engine', async () => {
    const plain = await createTestApp();
    expect((await getJson(plain.app, '/api/config')).body).toMatchObject({ speech: false });
    await plain.close();
    expect((await getJson(t.app, '/api/config')).body).toMatchObject({ speech: true });
  });
});
