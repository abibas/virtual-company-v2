import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CONTENT_TYPES,
  ARTIFACT_LIMITS,
  ARTIFACT_PARTS_MAX,
  ArtifactsDir,
  artifactContentType,
  artifactParts,
  artifactsFolder,
  isArtifactPath,
  Sha256Hex,
  stepFolder,
  taskFolder,
} from '../../src/flows.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('where a step writes its outputs', () => {
  it('names the task folder, the step folder by position and kebab name, and the round', () => {
    expect(taskFolder(12)).toBe('tasks/T-12');
    expect(stepFolder(2, 'Code review')).toBe('2-code-review');
    expect(stepFolder(3, 'QA — Ümlaut & co.')).toBe('3-qa-umlaut-co');
    expect(stepFolder(4, '???')).toBe('4-step');
    expect(stepFolder(5, `${'a'.repeat(39)}-b`)).toBe(`5-${'a'.repeat(39)}`);
    expect(artifactsFolder(12, { position: 1, name: 'Develop' }, 2)).toBe(
      'tasks/T-12/artifacts/1-develop/round-2',
    );
  });

  it('takes as an outputs folder only a relative path of plain names', () => {
    expect(ArtifactsDir.safeParse('tasks/T-12/artifacts/1-develop/round-1').success).toBe(true);
    for (const bad of ['', '/etc', 'tasks/../..', 'tasks/.hidden', 'a//b', 'a/b/', 'a b', 'x'.repeat(301)])
      expect(ArtifactsDir.safeParse(bad).success, bad).toBe(false);
  });
});

describe('artifact names and sizes', () => {
  it('takes a relative path without dot parts or control characters', () => {
    for (const good of ['notes.md', 'shots/login page.png', '.env.example', 'a/.b'])
      expect(isArtifactPath(good), good).toBe(true);
    for (const bad of ['', '/abs', 'a/../b', './a', 'a/', 'a\nb', 'x'.repeat(256)])
      expect(isArtifactPath(bad), bad).toBe(false);
  });

  it('counts the parts a file takes over the link', () => {
    expect(artifactParts(0)).toBe(1);
    expect(artifactParts(ARTIFACT_LIMITS.partBytes)).toBe(1);
    expect(artifactParts(ARTIFACT_LIMITS.partBytes + 1)).toBe(2);
    expect(artifactParts(ARTIFACT_LIMITS.fileBytes)).toBe(ARTIFACT_PARTS_MAX);
    expect(ARTIFACT_PARTS_MAX).toBe(16);
  });

  it('checks a SHA-256 in lower-case hex', () => {
    expect(Sha256Hex.safeParse('a'.repeat(64)).success).toBe(true);
    expect(Sha256Hex.safeParse('A'.repeat(64)).success).toBe(false);
  });
});

describe('artifactContentType', () => {
  it('tells the images from their first bytes', () => {
    expect(artifactContentType('x', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1))).toBe(
      'image/png',
    );
    expect(artifactContentType('x', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(artifactContentType('x', text('GIF89a'))).toBe('image/gif');
    expect(artifactContentType('x', text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('keeps UTF-8 text by its extension, an SVG as plain text', () => {
    expect(artifactContentType('notes.MD', text('# Notes'))).toBe('text/markdown; charset=utf-8');
    expect(artifactContentType('r.json', text('{}'))).toBe('application/json; charset=utf-8');
    expect(artifactContentType('r.csv', text('a,b'))).toBe('text/csv; charset=utf-8');
    expect(artifactContentType('r.html', text('<p>'))).toBe('text/html; charset=utf-8');
    expect(artifactContentType('logo.svg', text('<svg/>'))).toBe('text/plain; charset=utf-8');
    expect(artifactContentType('LICENSE', text('MIT – ok'))).toBe('text/plain; charset=utf-8');
    expect(artifactContentType('empty.txt', new Uint8Array())).toBe('text/plain; charset=utf-8');
  });

  it('refuses a binary file: a NUL byte or bytes that are not UTF-8', () => {
    expect(artifactContentType('a.txt', bytes(0x61, 0x00, 0x62))).toBeUndefined();
    expect(artifactContentType('a.bin', bytes(0xc3, 0x28))).toBeUndefined();
    expect(artifactContentType('build.zip', bytes(0x50, 0x4b, 0x03, 0x04, 0xff))).toBeUndefined();
  });

  it('lists every type it gives', () => {
    expect(ARTIFACT_CONTENT_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'text/markdown; charset=utf-8',
      'application/json; charset=utf-8',
      'text/csv; charset=utf-8',
      'text/html; charset=utf-8',
      'text/plain; charset=utf-8',
    ]);
  });
});
