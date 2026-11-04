import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../env.ts';
import { validationHook } from './errors.ts';

/** A router for one module; `createApp` mounts it with `app.route('/', router)`. */
export function newRouter(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
}
