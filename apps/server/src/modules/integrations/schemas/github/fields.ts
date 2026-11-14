import { z } from 'zod';

/** The fields the GitHub tools' inputs share (S7.1d): a repository, a number, a body's limit. */

/** The longest body a tool writes (a pull request's, a comment, a review): what the runner's socket carries. */
export const BODY_MAX = 50_000;

/** A repository owner, as GitHub allows one: letters, digits and dashes, up to 39. */
export const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** A repository name: letters, digits, `.`, `_` and `-`, up to 100, not `.` or `..`. */
export const REPO_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

export const owner = z.string().trim().regex(OWNER_PATTERN, 'a GitHub owner').describe('Repository owner');
export const repo = z.string().trim().regex(REPO_PATTERN, 'a repository name').describe('Repository name');
export const number = (what: string) => z.int().min(1).max(2_147_483_647).describe(what);

/** A pull request by its repository and number. */
export const pull = { owner, repo, pullNumber: number('Pull request number') };
