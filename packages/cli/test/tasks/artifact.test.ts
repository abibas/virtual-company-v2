import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/api/client.ts';
import type { TaskArtifact } from '../../src/api/tasks.ts';
import { parseArgs } from '../../src/args.ts';
import { findArtifact } from '../../src/tasks/artifact.ts';
import { taskCommand } from '../../src/tasks/commands.ts';
import { tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';
import { ORG_SERVER } from '../fixtures/org.ts';
import { type TasksWorld, tasksWorld } from '../fixtures/tasks.ts';

// The server's side of a task's artifacts is its own tests' (they need a runner); here the list and the downloads are
// answered by a fetch in front of the test app, which answers everything else.

let w: TasksWorld;
beforeAll(async () => {
  w = await tasksWorld();
});
afterAll(() => w.t.close());

const artifact = (extra: Partial<TaskArtifact>): TaskArtifact => ({
  id: 'a1',
  step: { id: 's1', name: 'Develop' },
  round: 1,
  name: 'notes.md',
  kind: 'file',
  contentType: 'text/markdown; charset=utf-8',
  size: 7,
  note: null,
  updatedAt: '2026-11-11T10:02:03.000Z',
  ...extra,
});

const LIST = [
  artifact({}),
  artifact({ id: 'a2', round: 2, size: 9 }),
  artifact({ id: 'a3', name: 'login.png', contentType: 'image/png', size: 4 }),
  artifact({
    id: 'a4',
    name: 'build.zip',
    kind: 'skipped',
    contentType: null,
    note: 'Not collected: binary',
  }),
  artifact({
    id: 'a5',
    step: { id: 's2', name: 'Code review' },
    name: 'hand-off note',
    kind: 'note',
    size: 4,
  }),
];
const BYTES: Record<string, [string, Uint8Array]> = {
  a1: ['text/markdown; charset=utf-8', new TextEncoder().encode('# One\n')],
  a2: ['text/markdown; charset=utf-8', new TextEncoder().encode('# Round two')],
  a3: ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  a5: ['text/markdown; charset=utf-8', new TextEncoder().encode('PASS')],
};

/** The test app, with a task's artifacts answered from `LIST` and `BYTES`. */
const withArtifacts =
  (inner: Fetch): Fetch =>
  async (url, init) => {
    const path = new URL(url).pathname;
    const content = /\/artifacts\/([^/]+)\/content$/.exec(path);
    if (content) {
      const [type, bytes] = BYTES[content[1] as string] ?? ['', new Uint8Array()];
      return type === ''
        ? Response.json(
            { error: { code: 'artifact_not_found', message: 'No such artifact' } },
            { status: 404 },
          )
        : new Response(bytes, { headers: { 'content-type': type } });
    }
    if (path.endsWith('/T-1/artifacts')) return Response.json({ artifacts: LIST });
    if (path.endsWith('/T-9/artifacts'))
      return Response.json(
        { error: { code: 'task_not_found', message: 'No such task in this company' } },
        { status: 404 },
      );
    return inner(url, init);
  };

async function task(argv: string[], cwd = '/repo') {
  const c = capture({ cwd, env: { ...tempConfig().env, MWC_SERVER: ORG_SERVER, MWC_API_KEY: w.key } });
  const code = await taskCommand(parseArgs(['task', ...argv]), c.io, { fetch: withArtifacts(w.fetch) });
  return { ...c, code };
}

describe('mwc task artifact', () => {
  it('prints the latest text artifact of that name, or the one --step and --round pick', async () => {
    await task(['create', '--flow', 'slop-box', '--title', 'Fix the login']);
    expect(await task(['artifact', 'T-1', 'notes.md'])).toMatchObject({ code: 0 });
    expect((await task(['artifact', 'T-1', 'notes.md'])).out()).toBe('# Round two\n');
    expect((await task(['artifact', 'T-1', 'notes.md', '--round', '1'])).out()).toBe('# One\n');
    expect((await task(['artifact', 'T-1', 'hand-off note', '--step', 'code review'])).out()).toBe('PASS\n');
    const json = JSON.parse((await task(['artifact', 'T-1', 'notes.md', '--json'])).out());
    expect(json.result).toMatchObject({ artifact: { id: 'a2' }, out: null, text: '# Round two' });
  });

  it('saves to --out, a file or into a folder; an image only so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwc-artifact-'));
    const image = await task(['artifact', 'T-1', 'login.png']);
    expect([image.code, image.err()]).toEqual([
      1,
      'mwc task artifact: login.png (Develop, round 1) is image/png: save it with --out <file>\n',
    ]);
    const saved = await task(['artifact', 'T-1', 'login.png', '--out', dir]);
    expect(saved.out()).toBe(`T-1 login.png (Develop, round 1) saved to ${join(dir, 'login.png')} (4 B)\n`);
    expect([...readFileSync(join(dir, 'login.png'))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await task(['artifact', 'T-1', 'hand-off note', '--out', '.'], dir);
    expect(readFileSync(join(dir, 'hand-off-note.md'), 'utf8')).toBe('PASS');
    await task(['artifact', 'T-1', 'notes.md', '--out', 'n.md'], dir);
    expect(readFileSync(join(dir, 'n.md'), 'utf8')).toBe('# Round two');
    const json = JSON.parse(
      (await task(['artifact', 'T-1', 'notes.md', '--out', 'j.md', '--json'], dir)).out(),
    );
    expect(json.result).toEqual({ artifact: expect.objectContaining({ id: 'a2' }), out: join(dir, 'j.md') });
  });

  it('says what is missing, a skipped file has no content, and passes refusals on', async () => {
    expect((await task(['artifact', 'T-1', 'nope.md'])).err()).toBe(
      'mwc task artifact: no artifact "nope.md"; it has notes.md, login.png, build.zip, hand-off note\n',
    );
    expect((await task(['artifact', 'T-1', 'build.zip'])).err()).toBe(
      'mwc task artifact: build.zip has no content (Not collected: binary)\n',
    );
    expect((await task(['artifact', 'T-9', 'notes.md'])).err()).toBe(
      'mwc task artifact: No such task in this company\n',
    );
    expect((await task(['artifact', 'T-1', 'notes.md', '--round', 'two'])).code).toBe(2);
    expect((await task(['artifact', 'T-1'])).code).toBe(2);
  });

  it('show lists the artifacts after the history', async () => {
    const lines = (await task(['show', 'T-1'])).out().trimEnd().split('\n');
    expect(lines.slice(-6)).toEqual([
      'Artifacts:',
      '  Develop · round 1 · notes.md · file · 7 B',
      '  Develop · round 2 · notes.md · file · 9 B',
      '  Develop · round 1 · login.png · file · 4 B',
      '  Develop · round 1 · build.zip · skipped, 7 B (Not collected: binary)',
      '  Code review · round 1 · hand-off note · note · 4 B',
    ]);
  });
});

describe('findArtifact', () => {
  it('names the step and round it looked in when nothing matches', () => {
    expect(findArtifact([], 'x', { step: 'QA', round: '2' })).toBe(
      'no artifact "x" at QA in round 2; it has none',
    );
    expect(findArtifact(LIST, 'notes.md', { step: 's1' })).toMatchObject({ id: 'a2' });
  });
});
