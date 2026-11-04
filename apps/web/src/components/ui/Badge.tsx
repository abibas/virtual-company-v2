const TONES = {
  pulse: 'text-pulse bg-pulse',
  amber: 'text-amber bg-amber',
  alarm: 'text-alarm bg-alarm',
  info: 'text-info bg-info',
  faint: 'text-dim bg-faint',
} as const;

type Tone = keyof typeof TONES;

/** Every status the identity pages show, with its tone and its words. */
const STATUSES: Readonly<Record<string, readonly [Tone, string]>> = {
  active: ['pulse', 'Active'],
  invited: ['amber', 'Invited'],
  suspended: ['alarm', 'Suspended'],
  removed: ['faint', 'Removed'],
  pending: ['amber', 'Pending'],
  accepted: ['info', 'Accepted'],
  revoked: ['faint', 'Revoked'],
  expired: ['faint', 'Expired'],
  failed: ['alarm', 'Failed'],
  provisioning: ['amber', 'Setting up'],
  deleted: ['faint', 'Deleted'],
  sent: ['pulse', 'Email sent'],
  sending: ['amber', 'Sending'],
};

/** A status as a dot and a word (colour is never the only signal). */
export function StatusBadge({ status }: { readonly status: string }) {
  const [tone, words] = STATUSES[status] ?? (['faint', status] as const);
  const [text, dot] = TONES[tone].split(' ');
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap ${text}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {words}
    </span>
  );
}

const ROLES: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** A membership role as people read it. */
export function roleName(role: string): string {
  return ROLES[role] ?? role;
}
