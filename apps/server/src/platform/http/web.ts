import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Logger } from 'pino';
import type { AppEnv } from '../env.ts';

/** Vite puts content-hashed files in assets/, so they never change; everything else must revalidate. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/**
 * Serves the built web UI from `webDist` after every API route: files as they are (assets/ cached
 * for a year, the rest revalidated), and index.html for any other GET without a file extension
 * outside /api, so client-side routes (a company's `/<slug>/...` among them) load the app. /api
 * paths never fall back to the UI; they keep the JSON 404.
 */
export function mountWeb(app: OpenAPIHono<AppEnv>, webDist: string, logger: Logger): void {
  const indexPath = join(webDist, 'index.html');
  if (!existsSync(indexPath)) {
    logger.warn({ webDist }, 'MWC_WEB_DIST has no index.html; the UI will not load');
  }

  app.get(
    '*',
    // serveStatic builds its response before its onFound hook runs, so cache headers go on afterwards.
    async (c, next) => {
      await next();
      if (c.res.status === 200 && !c.res.headers.has('cache-control')) {
        c.res.headers.set('cache-control', c.req.path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE);
      }
    },
    serveStatic({ root: webDist }),
  );

  app.get('*', async (c, next) => {
    const { path } = c.req;
    if (path === '/api' || path.startsWith('/api/') || extname(path) !== '') return next();
    let html: string;
    try {
      html = await readFile(indexPath, 'utf8');
    } catch {
      return next();
    }
    c.header('cache-control', REVALIDATE);
    return c.html(html);
  });
}
