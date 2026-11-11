import { join } from 'node:path';
import type { AskQuestion } from '@mwc/shared/harness';
import type { Log } from '../../src/system/log.ts';
import { type AskHost, askHost } from '../../src/turns/ask/bridge.ts';
import type { AskHandler, AskReply } from '../../src/turns/ask/tool.ts';
import { tempDir } from './runner.ts';

/** A question an agent asks: one pick of two options. */
export const QUESTION: AskQuestion = {
  question: 'Which database should the service use?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'The one the other services use' },
    { label: 'SQLite', description: 'A file beside the service, nothing to run' },
  ],
  multiSelect: false,
};

/** The MCP server's command as the daemon names it. */
export const TOOL_SERVER = { command: '/usr/local/bin/node', args: ['/opt/mwc-runner/runner.mjs', 'mcp'] };

/** A temporary root for turns' folders, short enough for a socket path. */
export const askRoot = (root = tempDir()) => join(root, 't');

/** The runner's tools on the real file system, under a temporary root. */
export function testAskHost(log: Log, root = askRoot()): AskHost {
  return askHost({ ...TOOL_SERVER, root, log });
}

/** A handler whose questions get `asked`'s answer and whose tools' calls get `called`'s (an error unless given). */
export function handlerOf(
  asked: AskHandler['ask'],
  called: AskHandler['tool'] = () => Promise.resolve<AskReply>({ ok: false, error: 'no tools here' }),
): AskHandler {
  return { ask: asked, tool: called };
}
