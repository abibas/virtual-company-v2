import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { actionRoutes } from './routes/actions.ts';
import { boardRoutes } from './routes/board.ts';
import { flowRoutes } from './routes/flows.ts';
import { taskRoutes } from './routes/tasks.ts';
import { tasksService } from './service.ts';

/**
 * The tasks module's routes (S5.3a, docs/processes.md): a team's flow and its steps (`routes/flows.ts`), its written
 * form and board (`routes/board.ts`), its tasks (`routes/tasks.ts`) and their moves (`routes/actions.ts`).
 */
export function tasksRoutes(deps: ServerDeps) {
  const tasks = tasksService(deps);
  return newRouter()
    .route('/', flowRoutes(deps, tasks))
    .route('/', boardRoutes(deps, tasks))
    .route('/', taskRoutes(deps, tasks))
    .route('/', actionRoutes(deps, tasks));
}
