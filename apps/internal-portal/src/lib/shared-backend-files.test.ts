import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The console imports a few of the API's own files (the document formats, the
 * journal rules) so the two cannot drift apart. The console's build installs
 * only the console's packages, so a file it borrows — or anything that file
 * imports — must not import a package: `class-transformer` slipped into
 * `common/validation/formats.ts` on 31 Oct 2026 and every Vercel build of the
 * console failed with it. This follows every borrowed file the way the
 * bundler does and fails on any package import. Type-only imports are erased
 * by the compiler and are allowed.
 */
const SRC = resolve(__dirname, '..');
const API = resolve(SRC, '../../internal-api');

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

const IMPORT = /^\s*import\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*export\s+[^'"]*?from\s+['"]([^'"]+)['"]/gm;

function importsOf(file: string): { spec: string; typeOnly: boolean }[] {
  const text = readFileSync(file, 'utf8');
  const found: { spec: string; typeOnly: boolean }[] = [];
  for (const m of text.matchAll(IMPORT)) found.push({ spec: m[2] ?? m[3], typeOnly: !!m[1] });
  return found;
}

function resolveTs(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

describe('API files the console borrows', () => {
  it('import no package, directly or through what they import', () => {
    const borrowed = new Set<string>();
    for (const file of files(SRC)) {
      for (const { spec } of importsOf(file)) {
        if (spec.includes('internal-api/src/')) {
          const target = resolveTs(file, spec);
          if (target) borrowed.add(target);
        }
      }
    }
    expect(borrowed.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const { spec, typeOnly } of importsOf(file)) {
        if (spec.startsWith('.')) {
          const next = resolveTs(file, spec);
          if (next) walk(next);
        } else if (!typeOnly && !spec.startsWith('node:')) {
          offenders.push(`${file.slice(API.length + 1).split('\\').join('/')} imports '${spec}'`);
        }
      }
    };
    borrowed.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
