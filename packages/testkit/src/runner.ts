/**
 * The runner protocol's fakes (`@mwc/testkit/runner`), loading no server and no database: `FakeRunnerServer` for the
 * runner's tests, `FakeRunner` for the server's hub tests, both speaking `@mwc/shared/runner-protocol` over real
 * WebSockets on 127.0.0.1.
 */
export {
  type CloseInfo,
  FAKE_CLAUDE_VERSION,
  FAKE_FOLDER_LIST,
  FakeRunner,
  type FakeRunnerOptions,
} from './runner/fake-runner.ts';
export {
  FakeRunnerServer,
  type FakeRunnerServerOptions,
  type RunnerConnection,
} from './runner/fake-server.ts';
export { FrameLog, type FrameOf } from './runner/frame-log.ts';
