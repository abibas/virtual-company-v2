import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthEnv } from '../../platform/auth/actor.ts';
import { type AuthDeps, authn } from '../../platform/auth/authn.ts';
import { BEARER_SCHEME, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { SPEECH_MAX_BYTES } from '../../platform/processes/speech/wav.ts';
import { type Speech, SpeechError } from '../../platform/processes/speech/whisper.ts';
import { ClipSchema, TranscriptSchema } from './schemas.ts';

/**
 * `POST /api/me/speech/transcribe` (S5.2, docs/speech.md): the composer's dictation. The body is the clip itself; the
 * answer its text and words. For a signed-in person, with a session or a personal API key; it reaches no company's
 * data and changes nothing, so it is not audited. The audio is read here, never logged or kept: whisper.cpp hears it
 * on the server's own computer and its temporary file is removed after the clip.
 */

const TRANSCRIBE = '/api/me/speech/transcribe' as const;
const WAV_TYPES = /^audio\/(wav|wave|x-wav)\s*(;|$)/i;

/** A person this server knows: a session of a linked person, or a personal API key (a run token never). */
function requirePerson(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const actor = c.var.actor;
    if (actor.kind !== 'user' || actor.userId === undefined)
      return errorJson(c, 403, 'user_not_linked', 'Finish signing in first: call GET /api/me once');
    await next();
  };
}

/** 503 before the body is read when dictation is off; 415 for a body that is not a WAV. */
function requireSpeech(speech: Speech | undefined): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (speech === undefined)
      return errorJson(
        c,
        503,
        'speech_unavailable',
        "Dictation is off: this server's computer has no whisper.cpp",
      );
    if (!WAV_TYPES.test(c.req.header('content-type') ?? ''))
      return errorJson(c, 415, 'unsupported_media_type', 'Send the clip as audio/wav');
    await next();
  };
}

/** 413 past 8 MB, from the length the request says or as it streams in. */
const sizeLimit = bodyLimit({
  maxSize: SPEECH_MAX_BYTES,
  onError: (c) => errorJson(c, 413, 'audio_too_large', 'A clip is at most two minutes and 8 MB'),
});

const transcribeRoute = (deps: AuthDeps, speech: Speech | undefined) =>
  createRoute({
    method: 'post',
    path: TRANSCRIBE,
    tags: ['speech'],
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: [authn(deps), requirePerson(), requireSpeech(speech), sizeLimit] as const,
    summary: "Transcribe a dictated clip on the server's computer",
    description:
      'The body is a 16 kHz mono 16-bit PCM WAV (`audio/wav`) of at most two minutes and 8 MB. whisper.cpp transcribes ' +
      "it on the server's own computer (no cloud service); the text comes back with each word's start and end in ms. " +
      'A clip with under 300 ms of voice comes back empty. The audio is never logged or kept.',
    request: { body: { content: { 'audio/wav': { schema: ClipSchema } }, required: true } },
    responses: {
      200: jsonResponse('What was said', TranscriptSchema),
      401: errorResponse('No credential, or one that is not valid (`unauthenticated`)'),
      403: errorResponse(
        'A session of a person not linked yet (`user_not_linked`), or a deactivated account',
      ),
      413: errorResponse('Longer than two minutes or larger than 8 MB (`audio_too_large`)'),
      415: errorResponse('The body is not `audio/wav` (`unsupported_media_type`)'),
      422: errorResponse('The body is not a 16 kHz mono 16-bit PCM WAV (`invalid_audio`)'),
      502: errorResponse('whisper.cpp could not transcribe the clip (`speech_failed`)'),
      503: errorResponse(
        "Dictation is off (`speech_unavailable`: MWC_WHISPER, or no whisper.cpp or model on the server's computer), " +
          'or sign-in is (`identity_not_configured`)',
      ),
    },
  });

/** The route on the server's deps and the speech engine (undefined: dictation is off, 503). */
export function speechRoutes(deps: AuthDeps & { readonly speech: Speech | undefined }) {
  return newRouter().openapi(transcribeRoute(deps, deps.speech), async (c) => {
    const clip = new Uint8Array(await c.req.arrayBuffer());
    try {
      // requireSpeech answered 503 already when there is none.
      const heard = await (deps.speech as Speech).transcribe(clip);
      return c.json({ text: heard.text, words: [...heard.words] }, 200);
    } catch (error) {
      if (!(error instanceof SpeechError)) throw error;
      if (error.code === 'too_long') return errorJson(c, 413, 'audio_too_large', error.message);
      if (error.code === 'not_wav') return errorJson(c, 422, 'invalid_audio', error.message);
      return errorJson(c, 502, 'speech_failed', error.message);
    } finally {
      clip.fill(0);
    }
  });
}
