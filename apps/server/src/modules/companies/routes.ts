import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { collectionRoutes } from './routes/collection.ts';
import { companyRoutes } from './routes/company.ts';
import { companiesService } from './service.ts';

/**
 * The companies (`/api/companies`): create and list mine (`routes/collection.ts`), read, rename and soft-delete one
 * (`routes/company.ts`).
 */
export function companiesRoutes(deps: ServerDeps) {
  const companies = companiesService(deps);
  return newRouter().route('/', collectionRoutes(deps, companies)).route('/', companyRoutes(deps, companies));
}
