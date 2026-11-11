import { z } from 'zod';
import { taskKey } from './keys.ts';

/**
 * A task's artifacts (S5.3b, docs/processes.md "Built in S5.3b"): where a step's outputs go on the agent's machine, the
 * limits the runner's collection, the protocol, the database and the API share, the name a file is kept under, and what
 * a file's bytes say it is (text or an image; anything else is not collected). Pure: the runner classifies what it
 * collects, and the server classifies again what it stores, never trusting the type a runner names.
 */

/** What one turn's collection takes, and how a file travels over the runner's link. */
export const ARTIFACT_LIMITS = {
  /** Files collected at a turn's end; the rest are listed as skipped (`too_many`). */
  files: 20,
  /** The largest file kept (2 MB); a larger one is skipped (`too_large`). */
  fileBytes: 2 * 1024 * 1024,
  /** All of a turn's files together (10 MB); past it the rest are skipped (`total_limit`). */
  totalBytes: 10 * 1024 * 1024,
  /** Skipped files a turn reports (the rest are left out of the list). */
  skipped: 50,
  /** A file's name: its path inside the round's folder, at most this many characters. */
  name: 255,
  /** Bytes per `turn.artifact` frame (base64 makes it 4/3 of this, well under the 256 KB frame limit). */
  partBytes: 128 * 1024,
  /** A note's or a skipped file's words. */
  note: 2_000,
} as const;

/** The most frames one file takes: its size over `partBytes`, rounded up (an empty file takes one). */
export const ARTIFACT_PARTS_MAX = Math.ceil(ARTIFACT_LIMITS.fileBytes / ARTIFACT_LIMITS.partBytes);

/** How many frames a file of `size` bytes takes. */
export const artifactParts = (size: number): number =>
  Math.max(1, Math.ceil(size / ARTIFACT_LIMITS.partBytes));

/** The step's final reply, kept as an artifact of the round it ended. */
export const HANDOFF_NOTE = 'hand-off note';

/** A task's folder under the agent's home folder: `tasks/T-12`. */
export const taskFolder = (number: number): string => `tasks/${taskKey(number)}`;

/**
 * A step's folder name, unique in its flow and in its order: its position and its name in lower-case kebab
 * (`2-code-review`); a name with no letters or digits leaves the position alone (`3-step`).
 */
export function stepFolder(position: number, name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${position}-${slug || 'step'}`;
}

/**
 * Where a step writes a round's outputs, relative to the agent's home folder:
 * `tasks/T-12/artifacts/2-code-review/round-1`.
 */
export const artifactsFolder = (
  number: number,
  step: { readonly position: number; readonly name: string },
  round: number,
): string => `${taskFolder(number)}/artifacts/${stepFolder(step.position, step.name)}/round-${round}`;

/** One folder name of a relative path the server names: letters, digits, `.`, `_`, `-`, never starting with a dot. */
const FOLDER_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** A folder under the agent's home folder, as a turn's spec names it (`TurnSpec.artifacts.dir`): relative, plain. */
export const ArtifactsDir = z
  .string()
  .min(1)
  .max(300)
  .refine((path) => path.split('/').every((segment) => FOLDER_SEGMENT.test(segment)), {
    message: 'a relative folder of plain names (letters, digits, ".", "_", "-"; no leading dot)',
  });

/** Control characters, which no artifact name holds. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find them.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** True for a file's path inside a round's folder: relative, no `.` or `..` part, no control character. */
export function isArtifactPath(path: string): boolean {
  if (path.length === 0 || path.length > ARTIFACT_LIMITS.name || CONTROL.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** A file's path inside a round's folder (`notes.md`, `shots/login.png`), as collected. */
export const ArtifactPath = z.string().refine(isArtifactPath, {
  message: `a relative path of at most ${ARTIFACT_LIMITS.name} characters, without "." or ".." parts`,
});

/** A SHA-256 as lower-case hex. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 in lower-case hex');

/** The image types kept, told from their first bytes. */
const IMAGES: readonly { readonly type: string; readonly test: (b: Uint8Array) => boolean }[] = [
  { type: 'image/png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: 'image/jpeg', test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { type: 'image/gif', test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    type: 'image/webp',
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

const starts = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);

/** Text types by extension; any other text is `text/plain`. An SVG is kept as text, never served as an image. */
const TEXT_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
};

/** Every content type an artifact is kept with. */
export const ARTIFACT_CONTENT_TYPES: readonly string[] = [
  ...IMAGES.map((image) => image.type),
  ...new Set(Object.values(TEXT_TYPES).map((type) => `${type}; charset=utf-8`)),
  'text/plain; charset=utf-8',
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** True for UTF-8 text without a NUL byte. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    utf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a file is, from its bytes (and, for text, its name's extension): a PNG, JPEG, GIF or WebP image by its first
 * bytes; UTF-8 text without a NUL byte as Markdown, JSON, CSV, HTML or plain text (`; charset=utf-8`); undefined for
 * anything else (a binary file, which is not collected).
 */
export function artifactContentType(name: string, bytes: Uint8Array): string | undefined {
  const image = IMAGES.find((candidate) => candidate.test(bytes));
  if (image) return image.type;
  if (!isText(bytes)) return undefined;
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return `${TEXT_TYPES[extension] ?? 'text/plain'}; charset=utf-8`;
}
