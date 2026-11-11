import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every file the console names from `public/` — `/nexraah-logo.png` on the
 * sign-in page and in the sign-in email, `/push-sw.js` for browser alerts —
 * must be there. On 10 Nov 2026 a commit deleted both by accident; nothing
 * failed, and the sign-in logo was a broken image on every site.
 */
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'mocks' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('files served from public/', () => {
  it('exist for every one the code names', () => {
    const named = new Set<string>();
    for (const file of sources(join(ROOT, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/['"`(]\/([\w.-]+\.(?:png|jpe?g|webp|svg|ico|js))(?=[?'"`)])/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(2);
    expect([...named].filter((name) => !existsSync(join(PUBLIC, name)))).toEqual([]);
  });
});
