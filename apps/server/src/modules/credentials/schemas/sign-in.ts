import { z } from '@hono/zod-openapi';
import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { SIGN_IN_CODE, SIGN_IN_PROVIDERS, SIGN_IN_STATES } from '../rules/sign-in.ts';

/**
 * The sign-in API's shapes (`/api/me/subscriptions/sign-in`, S3.2). A sign-in shows the person the provider's address
 * (and OpenAI's one-time code) and, once done, the id of the stored subscription: never a token, a file or the code
 * they pasted.
 */

export const SignInProviderSchema = z.enum(SIGN_IN_PROVIDERS).openapi('SignInProvider');
export const SignInStateSchema = z.enum(SIGN_IN_STATES).openapi('SignInState');

export const SignInParamsSchema = z.object({
  signInId: z.string().openapi({
    param: { name: 'signInId', in: 'path' },
    example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b',
  }),
});

/** Which subscription to sign in to, and optionally its name (by default "Claude · <email>" or "OpenAI · <email>"). */
export const StartSignInSchema = z
  .object({
    provider: SignInProviderSchema,
    label: z
      .string()
      .trim()
      .min(CREDENTIAL_LABEL.min, 'A name is required')
      .max(CREDENTIAL_LABEL.max, `A name is at most ${CREDENTIAL_LABEL.max} characters`)
      .optional()
      .openapi({ example: 'Max at home' }),
  })
  .openapi('StartSignIn');

/** The code Anthropic's page shows after Claude's approval, pasted back whole. */
export const SignInCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(SIGN_IN_CODE, 'Paste the whole code Claude showed you, as one word')
      .openapi({ example: 'aBcD1234efGH5678#xyZ0987' }),
  })
  .openapi('SignInCode');

/** A sign-in as the person sees it while the web polls it. */
export const SignInSchema = z
  .object({
    id: z.string(),
    provider: SignInProviderSchema,
    state: SignInStateSchema,
    url: z.string().nullable().openapi({
      description: "The provider's sign-in address, once the CLI has shown it",
      example: 'https://auth.openai.com/codex/device',
    }),
    userCode: z.string().nullable().openapi({
      description: "OpenAI's one-time code, typed in on its page",
      example: 'ABCD-EFGH2',
    }),
    credentialId: z.string().nullable().openapi({ description: 'The stored subscription, once done' }),
    message: z
      .string()
      .nullable()
      .openapi({ description: 'Why it failed, expired or was cancelled, in plain words' }),
    createdAt: z.string().openapi({ format: 'date-time' }),
    expiresAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('SignIn');

export type StartSignIn = z.infer<typeof StartSignInSchema>;
export type SignInView = z.infer<typeof SignInSchema>;
