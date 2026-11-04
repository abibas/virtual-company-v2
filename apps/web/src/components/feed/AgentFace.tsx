/**
 * The drawn faces agents wear until they have one of their own (S2): a round head on a tinted ground, with a
 * small difference per variant (glasses, a visor, an antenna, headphones, a fringe, a wink) so a row of them
 * reads as different people.
 */
const GROUNDS = ['#dbe4ff', '#d3f3ee', '#e6dfff', '#ffe8c7', '#d8f5e3', '#ffdcd3', '#e2e6f3'] as const;
const SKINS = ['#2d5cff', '#11a897', '#6f52ee', '#c97d0b', '#1b8f52', '#d9533a', '#3a4164'] as const;

function Extra({ variant, color }: { readonly variant: number; readonly color: string }) {
  switch (variant % 6) {
    case 0:
      // Round glasses.
      return (
        <g fill="none" stroke={color} strokeWidth="2.2">
          <circle cx="25" cy="31" r="5.5" />
          <circle cx="39" cy="31" r="5.5" />
          <path d="M30.5 31h3" />
        </g>
      );
    case 1:
      // A visor band.
      return <rect x="18" y="26" width="28" height="8" rx="4" fill={color} opacity="0.9" />;
    case 2:
      // An antenna.
      return (
        <g fill={color}>
          <rect x="31" y="6" width="2.4" height="9" rx="1.2" />
          <circle cx="32.2" cy="5.5" r="3" />
        </g>
      );
    case 3:
      // Headphones.
      return (
        <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
          <path d="M16 32c0-10 7-17 16-17s16 7 16 17" />
          <rect x="13" y="30" width="6" height="9" rx="3" fill={color} />
          <rect x="45" y="30" width="6" height="9" rx="3" fill={color} />
        </g>
      );
    case 4:
      // A fringe.
      return <path d="M17 26c3-8 9-12 15-12s12 4 15 12c-5-3-10-4-15-4s-10 1-15 4Z" fill={color} />;
    default:
      return null;
  }
}

/** A 64×64 face, `variant` picking its colours and feature. Decorative: the name travels with the avatar. */
export function AgentFace({
  variant = 0,
  muted = false,
}: {
  readonly variant?: number;
  readonly muted?: boolean;
}) {
  const index = Math.abs(variant) % GROUNDS.length;
  const ground = GROUNDS[index] ?? GROUNDS[0];
  const skin = SKINS[index] ?? SKINS[0];
  const wink = variant % 6 === 5;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="size-full"
      style={muted ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined}
    >
      <rect width="64" height="64" fill={ground} />
      <path d="M8 64c2-13 11-20 24-20s22 7 24 20Z" fill={skin} opacity="0.85" />
      <circle cx="32" cy="30" r="15" fill="#fff" />
      <circle cx="32" cy="30" r="15" fill={skin} opacity="0.12" />
      <circle cx="26.5" cy="30" r="1.9" fill={skin} />
      {wink ? (
        <path d="M35.5 30.3h4" stroke={skin} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <circle cx="37.5" cy="30" r="1.9" fill={skin} />
      )}
      <path d="M28 36.5c2.5 2 5.5 2 8 0" fill="none" stroke={skin} strokeWidth="1.8" strokeLinecap="round" />
      <Extra variant={variant} color={skin} />
    </svg>
  );
}
