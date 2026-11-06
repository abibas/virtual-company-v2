import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATH_DIRS,
  type ExecFile,
  type ExecFileError,
  type ExecFileOptions,
  processRun,
  RUN_MAX_BUFFER,
  runEnv,
} from '../src/run.ts';

interface Exec {
  readonly file: string;
  readonly args: string[];
  readonly options: ExecFileOptions;
}

/** An `execFile` that answers every call with the same callback arguments, never starting a process. */
function fakeExecFile(error: ExecFileError | null, stdout = '', stderr = '') {
  const execs: Exec[] = [];
  const execFile: ExecFile = (file, args, options, callback) => {
    execs.push({ file, args, options });
    callback(error, stdout, stderr);
  };
  return { execFile, execs };
}

function execError(fields: Partial<ExecFileError>): ExecFileError {
  return Object.assign(new Error('exec failed'), fields);
}

describe('runEnv', () => {
  it('is the short PATH, gcloud’s prompts off and only the passed variables that are set', () => {
    const env = runEnv(
      { HOME: '/Users/ihor', USER: 'ihor', TMPDIR: '', SECRET_TOKEN: 'x', PATH: '/very/long:/path' },
      ['/a', '/b'],
    );
    expect(env).toEqual({
      PATH: '/a:/b',
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
      NO_COLOR: '1',
      HOME: '/Users/ihor',
      USER: 'ihor',
    });
    expect(DEFAULT_PATH_DIRS[0]).toBe('/opt/homebrew/bin');
  });
});

describe('processRun', () => {
  it('runs the command with its argument array, no shell, the timeout and the short PATH', async () => {
    const { execFile, execs } = fakeExecFile(null, '{"ok":true}', 'note');
    const run = processRun({ execFile, env: { HOME: '/h' } });
    const args = ['compute', 'instances', 'list', '--filter', 'labels.owner=x AND y'];
    expect(await run('gcloud', args, { timeoutMs: 30_000 })).toEqual({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: 'note',
      timedOut: false,
    });
    expect(execs[0]).toEqual({
      file: 'gcloud',
      args,
      options: {
        env: {
          PATH: DEFAULT_PATH_DIRS.join(':'),
          CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
          NO_COLOR: '1',
          HOME: '/h',
        },
        timeout: 30_000,
        maxBuffer: RUN_MAX_BUFFER,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      },
    });
    expect(execs[0]?.args).not.toBe(args);
    // Built on Node's execFile and process.env by default; building it starts nothing.
    expect(processRun()).toBeTypeOf('function');
  });

  it('resolves a non-zero exit with its code and output', async () => {
    const { execFile } = fakeExecFile(execError({ code: 1 }), '', 'ERROR: x');
    expect(
      await processRun({ execFile, pathDirs: ['/x'] })('airia', ['devbox', 'stop'], { timeoutMs: 1 }),
    ).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'ERROR: x',
      timedOut: false,
    });
  });

  it('says when the command was killed for its timeout, and not for too much output', async () => {
    const killed = fakeExecFile(execError({ code: null, killed: true, signal: 'SIGTERM' }));
    expect(await processRun({ execFile: killed.execFile })('airia', [], { timeoutMs: 1 })).toMatchObject({
      exitCode: null,
      timedOut: true,
    });
    const tooMuch = fakeExecFile(execError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }));
    expect(await processRun({ execFile: tooMuch.execFile })('gcloud', [], { timeoutMs: 1 })).toMatchObject({
      exitCode: null,
      timedOut: false,
    });
  });

  it('rejects with the spawn error when the command cannot start', async () => {
    const missing = execError({ code: 'ENOENT' });
    const { execFile } = fakeExecFile(missing);
    await expect(processRun({ execFile })('airia', [], { timeoutMs: 1 })).rejects.toBe(missing);
  });
});
