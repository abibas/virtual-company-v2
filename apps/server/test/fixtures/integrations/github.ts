/**
 * The GitHub tools' tests helpers (S7.1d): a chat scene (`githubScene`) whose runner takes the server's tools and a
 * GitHub sign-in for git, and whose profile has a GitHub part (a sign-in sealed as the store does, and its rights), and
 * GitHub's REST answers at `api.github.com`. Never a real GitHub: every call goes to the fake provider (`w.provider`).
 */
import { accessProfiles, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { GitHubRights } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { type ChatsWorld, type Scene, type SceneOptions, scene, startedTurn } from '../chats/world.ts';
import { addSignIn } from '../org.ts';

export { answerOf, callTool, principalOf, serverToolNames, statusOf, toolAudit } from './atlassian.ts';

/** GitHub's API, where the connector calls. */
export const API = 'https://api.github.com';
export const REPOS = `${API}/repos`;

/** The token the sealed `github_oauth` test sign-in holds (`SECRETS` of the profiles' fixtures), never shown. */
export const TOKEN = 'gho_GHLOGINtokenNEVERshown';

/** Rights that read, push and open pull requests in `AiriaLLC/*` and `abibas/sandbox`, unless changed. */
export const PUSH_PRS: GitHubRights = {
  repos: ['AiriaLLC/*', 'abibas/sandbox'],
  push: true,
  pullRequests: true,
};

export interface GitHubSceneOptions extends SceneOptions {
  readonly rights?: Partial<GitHubRights> | null;
  /** Leave the part without a sign-in. */
  readonly noSignIn?: boolean;
}

export interface GitHubScene extends Scene {
  readonly signIn: SubscriptionView;
}

/** Sets a profile's GitHub part straight in the table (no rules checked): its sign-in and rights, or none. */
export async function putGitHubPart(
  db: DbHandle,
  profileId: string,
  part: { readonly credentialId: string | null; readonly rights: GitHubRights | null },
): Promise<void> {
  await rawDb(db)
    .update(accessProfiles)
    .set({ githubCredentialId: part.credentialId, githubRights: part.rights })
    .where(eq(accessProfiles.id, profileId));
}

/** The chat scene on a runner that takes the server's tools and git's sign-in, its profile with a GitHub part. */
export async function githubScene(w: ChatsWorld, options: GitHubSceneOptions = {}): Promise<GitHubScene> {
  const s = await scene(w, { ...options, caps: { serverTools: true, github: true, ...options.caps } });
  const signIn = await addSignIn(w, w.keyring, s.company.owner.userId, 'github_oauth');
  const rights = options.rights === null ? null : { ...PUSH_PRS, ...options.rights };
  const credentialId = options.noSignIn || rights === null ? null : signIn.id;
  await putGitHubPart(w.t.db, s.profile.id, { credentialId, rights });
  return { ...s, signIn };
}

/** A turn started on the scene, as the runner got it. */
export const githubTurn = (
  w: ChatsWorld,
  s: Scene,
  prompt = 'What is my latest PR in AiriaLLC/airia-platform?',
) => startedTurn(w, s, prompt);

/** A pull request as GitHub's REST API gives it. */
export const rawPull = (repo: string, number: number, extra: Record<string, unknown> = {}) => ({
  number,
  node_id: `PR_${number}`,
  title: `Pull ${number}`,
  state: 'open',
  draft: false,
  html_url: `https://github.com/${repo}/pull/${number}`,
  user: { login: 'ihor-fake' },
  head: { ref: `feature-${number}`, sha: `sha${number}`, repo: { full_name: repo } },
  base: { ref: 'main', repo: { full_name: repo } },
  body: `About ${number}.`,
  ...extra,
});

/** An issue or pull request as GitHub's search gives it. */
export const rawHit = (repo: string, number: number, pull = true) => ({
  number,
  title: `Hit ${number}`,
  state: 'open',
  html_url: `https://github.com/${repo}/${pull ? 'pull' : 'issues'}/${number}`,
  repository_url: `${API}/repos/${repo}`,
  user: { login: 'ihor-fake' },
  ...(pull ? { pull_request: { url: 'x' } } : {}),
  body: 'b',
});
