/**
 * `mwc check`'s "db drift" step in one Node process: the migrations drift check (check-migrations.ts)
 * and the schema diagram check (schema-diagram.ts --check). Both always run, so one run shows both
 * problems; the exit code is the worse of the two (0 current, 1 drift, 2 a tool failed).
 *
 *   node scripts/check-drift.ts
 */
import { checkMigrations } from './check-migrations.ts';
import { checkDiagram } from './schema-diagram.ts';

process.exitCode = Math.max(checkMigrations(), checkDiagram());
