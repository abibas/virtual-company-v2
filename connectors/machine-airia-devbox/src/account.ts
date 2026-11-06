/**
 * The owner slug the airia CLI derives from a gcloud account (`owner_slug`): the local part, lowercased, every
 * character outside `a-z0-9-` folded to a hyphen, hyphens trimmed from both ends, at most 50 characters. Its box is
 * `dev-<slug>`, and its boxes carry the label `owner=<slug>`.
 */
export function ownerSlug(account: string): string {
  const trimmed = account.trim();
  const at = trimmed.indexOf('@');
  return (at === -1 ? trimmed : trimmed.slice(0, at))
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** The box the airia CLI acts on for an account: `dev-<slug>`. */
export function boxNameOf(account: string): string {
  return `dev-${ownerSlug(account)}`;
}

/**
 * The account in `gcloud config get-value account`'s output, or null when none is set (empty, or `(unset)`).
 */
export function accountFrom(stdout: string): string | null {
  const account = stdout.trim();
  return account === '' || account === '(unset)' ? null : account;
}
