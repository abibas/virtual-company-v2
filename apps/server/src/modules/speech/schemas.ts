import { z } from '@hono/zod-openapi';

/** The clip, as the body of `POST /api/me/speech/transcribe`: a 16 kHz mono 16-bit PCM WAV of at most two minutes. */
export const ClipSchema = z.string().openapi({ type: 'string', format: 'binary' });

export const SpeechWordSchema = z
  .object({
    text: z.string().openapi({ example: 'hello' }),
    start: z
      .number()
      .int()
      .min(0)
      .openapi({ example: 120, description: 'Where the word starts in the clip, in ms' }),
    end: z.number().int().min(0).openapi({ example: 480, description: 'Where it ends, in ms' }),
  })
  .openapi('SpeechWord');

export const TranscriptSchema = z
  .object({
    text: z.string().openapi({
      example: 'Hello there.',
      description: 'What was said; empty when the clip had under 300 ms of voice',
    }),
    words: z.array(SpeechWordSchema),
  })
  .openapi('Transcript');
