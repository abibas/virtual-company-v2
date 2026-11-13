import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The runner's git hooks (S7.1d, docs/harness.md "git in a turn"): a turn whose profile may push to GitHub runs git with
 * `core.hooksPath` pointing here (set in its environment, `env.ts`), so its pushes pass `pre-push` first. That hook
 * refuses, in words, a push to the remote's default branch, a push that is not a fast-forward of what the remote has (so
 * never a force), a deletion, and a push to a GitHub repository outside the profile's (`MWC_GIT_REPOS`: `all`, or
 * `owner/name` and `owner/*`, lower-case). Since `core.hooksPath` replaces the repository's own hooks, each hook here then
 * runs the repository's own hook of the same name (its own `core.hooksPath`, else its git folder's `hooks/`), so a
 * repository's pre-commit or commit-msg checks still run. POSIX `sh`, git and `awk` only. It prevents mistakes, not
 * malice: `git push --no-verify` skips it and the agent may unset its environment; GitHub's branch protection is the hard
 * guarantee. The folder and its files are read-only (0555), rewritten when the runner's version of them changes.
 */

/** The client-side hooks a turn's git may run (not `reference-transaction`: it would start a shell on every ref change). */
export const HOOK_NAMES = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'pre-auto-gc',
  'sendemail-validate',
] as const;

/** Where the runner writes them under its state folder. */
export const gitHooksDir = (stateDir: string) => join(stateDir, 'git-hooks');

/** Every hook's text: one script that knows which hook it is by its name. */
export const HOOK_SCRIPT = `#!/bin/sh
# Most Wanted's git hooks (written by the runner; see docs/harness.md "git in a turn"). pre-push refuses a push to the
# remote's default branch, one that is not a fast-forward, a deletion, and one to a GitHub repository outside
# MWC_GIT_REPOS; every hook then runs the repository's own hook of its name. It prevents mistakes, not malice.
hook=\${0##*/}
here=\${0%/*}
say() { printf 'Most Wanted: %s\\n' "$*" >&2; }

# The repository's own hooks folder: its core.hooksPath from any scope but the turn's, else its git folder's hooks.
own_dir() {
  dir=$(git config --show-scope --type=path --get-all core.hooksPath 2>/dev/null |
    awk -F '\\t' '$1 != "command" { last = $2 } END { print last }')
  [ -n "$dir" ] || dir="$(git rev-parse --git-common-dir 2>/dev/null)/hooks"
  [ "$dir" = "$here" ] || printf '%s\\n' "$dir"
}

is_zero() {
  case $1 in *[!0]*) return 1 ;; *) return 0 ;; esac
}

# The GitHub repository a remote address names (owner/name, lower-case), or nothing for another host.
github_repo() {
  case $1 in
    https://github.com/*) slug=\${1#https://github.com/} ;;
    https://*@github.com/*) slug=\${1#*@github.com/} ;;
    git@github.com:*) slug=\${1#git@github.com:} ;;
    ssh://git@github.com/*) slug=\${1#ssh://git@github.com/} ;;
    *) return 0 ;;
  esac
  slug=\${slug%/}
  slug=\${slug%.git}
  printf '%s\\n' "$slug" | tr '[:upper:]' '[:lower:]'
}

# Refuses a GitHub repository outside the profile's, by its remote address.
check_repo() {
  repo=$(github_repo "$1")
  [ -n "$repo" ] && [ -n "\${MWC_GIT_REPOS:-}" ] && [ "$MWC_GIT_REPOS" != all ] || return 0
  owner=\${repo%%/*}
  set -f
  old_ifs=$IFS
  IFS=,
  for entry in $MWC_GIT_REPOS; do
    if [ "$entry" = "$repo" ] || [ "$entry" = "$owner/*" ]; then
      IFS=$old_ifs
      set +f
      return 0
    fi
  done
  IFS=$old_ifs
  set +f
  say "refused: $repo is outside the GitHub repositories this agent's profile reaches ($MWC_GIT_REPOS)."
  return 1
}

# The remote's default branch: its HEAD as fetched, else as the remote says now, else main and master.
default_branches() {
  head=$(git symbolic-ref --quiet "refs/remotes/$1/HEAD" 2>/dev/null)
  if [ -n "$head" ]; then
    printf '%s\\n' "\${head#"refs/remotes/$1/"}"
    return
  fi
  head=$(git ls-remote --symref "$2" HEAD 2>/dev/null | awk '$1 == "ref:" { sub("^refs/heads/", "", $2); print $2; exit }')
  printf '%s\\n' "\${head:-main master}"
}

# pre-push: each ref it pushes, from its input ("<local ref> <local oid> <remote ref> <remote oid>").
check_refs() {
  defaults=$(default_branches "$1" "$2")
  status=0
  while read -r local_ref local_oid remote_ref remote_oid; do
    [ -n "$remote_ref" ] || continue
    if is_zero "$local_oid"; then
      say "refused: deleting $remote_ref; nothing here deletes a branch or a tag."
      status=1
      continue
    fi
    branch=\${remote_ref#refs/heads/}
    for name in $defaults; do
      if [ "$remote_ref" != "$branch" ] && [ "$branch" = "$name" ]; then
        say "refused: $branch is the default branch of $1; push a branch of your own and open a pull request."
        status=1
      fi
    done
    if ! is_zero "$remote_oid" && ! git merge-base --is-ancestor "$remote_oid" "$local_oid" 2>/dev/null; then
      say "refused: $remote_ref is not a fast-forward of what $1 has (fetch and rebase or merge first); never force."
      status=1
    fi
  done <<EOF
$input
EOF
  return $status
}

if [ "$hook" = pre-push ]; then
  input=$(cat)
  check_repo "$2" || exit 1
  check_refs "$1" "$2" || exit 1
  own=$(own_dir)
  if [ -n "$own" ] && [ -x "$own/$hook" ]; then
    printf '%s\\n' "$input" | "$own/$hook" "$@"
    exit $?
  fi
  exit 0
fi
own=$(own_dir)
if [ -n "$own" ] && [ -x "$own/$hook" ]; then
  exec "$own/$hook" "$@"
fi
exit 0
`;

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Writes the hooks into `dir` unless they are there as this runner wrote them: each hook file holds `HOOK_SCRIPT`, 0555,
 * in a 0555 folder (made writable for the moment of a rewrite). Gives the folder, or throws when it cannot be written.
 */
export function writeGitHooks(dir: string): string {
  const stale = HOOK_NAMES.filter((name) => readText(join(dir, name)) !== HOOK_SCRIPT);
  if (stale.length === 0 && (statSync(dir).mode & 0o777) === 0o555) return dir;
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  chmodSync(dir, 0o755);
  try {
    for (const name of stale) {
      const path = join(dir, name);
      if (readText(path) !== undefined) chmodSync(path, 0o755);
      writeFileSync(path, HOOK_SCRIPT, { mode: 0o555 });
      chmodSync(path, 0o555);
    }
  } finally {
    chmodSync(dir, 0o555);
  }
  return dir;
}
