import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { ago, ref } from './flow-sample.ts';

/**
 * The gallery's task artifacts (S5.3b), as `GET /tasks/:key/artifacts` lists them, and their bytes: T-12's hand-off
 * notes in every round, a screenshot from Develop and from QA (drawn on a canvas), a Markdown file, a diff, and two
 * files left out; T-17's one note.
 */

type Kind = TaskArtifact['kind'];

const STEPS: Readonly<Record<string, string>> = {
  's-dev': 'Develop',
  's-review': 'Code review',
  's-qa': 'QA',
};
const AGENTS: Readonly<Record<string, string>> = {
  's-dev': 'p-mason',
  's-review': 'p-juno',
  's-qa': 'p-pip',
};

const NOTES_MD = `# Safari sign-in

## What changed
- \`SameSite=Lax\` on the session cookie (\`session.ts\`)
- \`redirect_url\` kept through the round trip

## How it was checked
| Browser | Result |
| --- | --- |
| Safari 19 | signed in |
| Chrome 140 | signed in |

\`\`\`sh
pnpm test auth   # 14 passed
\`\`\``;

const DIFF = `--- a/apps/server/src/platform/http/session.ts
+++ b/apps/server/src/platform/http/session.ts
@@ -21,7 +21,8 @@ export function sessionCookie(token: string) {
   return serialize('session', token, {
     httpOnly: true,
     secure: true,
-    sameSite: 'strict',
+    // Safari drops a strict cookie after the cross-site redirect from the sign-in page.
+    sameSite: 'lax',
     path: '/',
   });`;

/** The texts by artifact id. */
const TEXTS: Readonly<Record<string, string>> = {
  'a-1': 'Set `SameSite=Lax` on the session cookie and kept `redirect_url` through the round trip.',
  'a-2': 'SEND BACK\nNo test for the Safari path.',
  'a-3':
    'Added the Safari path test.\n\n- `auth.test.ts`: signs in through the redirect\n- `pnpm test auth`: 14 passed',
  'a-4': NOTES_MD,
  'a-5': DIFF,
  'a-8': 'PASS\nThe test covers it.',
  'a-9': 'PASS\nSigned in on Safari 19.',
  'a-11': 'PASS\nThe cache key includes the company; one nit left in a comment.',
};

type Spec = readonly [
  id: string,
  step: string,
  round: number,
  name: string,
  kind: Kind,
  type: string | null,
  minutes: number,
  note?: string,
];

const SPECS: Readonly<Record<string, readonly Spec[]>> = {
  'T-12': [
    ['a-1', 's-dev', 1, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 60 * 25],
    ['a-2', 's-review', 1, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 60 * 18],
    ['a-3', 's-dev', 2, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 181],
    ['a-4', 's-dev', 2, 'notes.md', 'file', 'text/markdown; charset=utf-8', 182],
    ['a-5', 's-dev', 2, 'session.diff', 'file', 'text/plain; charset=utf-8', 182],
    ['a-6', 's-dev', 2, 'shots/login-safari.png', 'file', 'image/png', 182],
    ['a-7', 's-dev', 2, 'trace.zip', 'skipped', null, 182, 'Not collected: neither text nor an image'],
    ['a-12', 's-dev', 2, 'recording.mov', 'skipped', null, 182, 'Not collected: over the 2 MB a file may be'],
    ['a-8', 's-review', 2, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 91],
    ['a-9', 's-qa', 1, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 10],
    ['a-10', 's-qa', 1, 'shots/qa-safari-19.png', 'file', 'image/png', 10],
  ],
  'T-17': [['a-11', 's-review', 1, 'hand-off note', 'note', 'text/markdown; charset=utf-8', 70]],
};

const sizeOf = (id: string, kind: Kind) =>
  kind === 'skipped' ? 4_812_330 : TEXTS[id] ? new TextEncoder().encode(TEXTS[id]).length : 48_640;

/** A sample task's artifacts, oldest first. */
export const sampleArtifacts = (key: string): TaskArtifact[] =>
  (SPECS[key] ?? []).map(([id, step, round, name, kind, contentType, minutes, note]) => ({
    id,
    step: { id: step, name: STEPS[step] ?? step },
    round,
    name,
    kind,
    contentType,
    size: sizeOf(id, kind),
    sha256: kind === 'skipped' ? null : `sample-${id}`,
    note: note ?? null,
    chatId: null,
    turnId: null,
    createdBy: ref(AGENTS[step] ?? 'p-mason'),
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
  }));

/** A browser window with the sign-in page, signed in: a screenshot to show, drawn on a canvas. */
function screenshot(label: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  const g = canvas.getContext('2d');
  if (!g) return Promise.reject(new Error('No canvas'));
  const box = (colour: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = colour;
    g.fillRect(x, y, w, h);
  };
  const text = (colour: string, font: string, words: string, x: number, y: number) => {
    g.fillStyle = colour;
    g.font = font;
    g.fillText(words, x, y);
  };
  box('#eef1f6', 0, 0, 640, 400);
  box('#ffffff', 0, 0, 640, 40);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((colour, i) => {
    g.fillStyle = colour;
    g.beginPath();
    g.arc(22 + i * 18, 20, 6, 0, Math.PI * 2);
    g.fill();
  });
  box('#e3e7ee', 180, 11, 280, 18);
  box('#ffffff', 90, 70, 460, 290);
  text('#1b1f2a', 'bold 40px system-ui, sans-serif', 'Signed in', 125, 135);
  text('#6b7280', '24px system-ui, sans-serif', label, 125, 172);
  box('#dcfce7', 125, 200, 390, 60);
  text('#15803d', 'bold 22px system-ui, sans-serif', 'Session kept after redirect', 145, 238);
  box('#2563eb', 125, 290, 390, 44);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/png'),
  );
}

/** A sample artifact's bytes. */
export async function sampleBytes(artifact: TaskArtifact): Promise<Blob> {
  if (artifact.contentType === 'image/png')
    return screenshot(artifact.step.name === 'QA' ? 'Safari 19 · QA' : 'Safari 19');
  const text = TEXTS[artifact.id];
  if (text === undefined) throw new Error('Sample data: no bytes');
  return new Blob([text], { type: artifact.contentType ?? 'text/plain' });
}
