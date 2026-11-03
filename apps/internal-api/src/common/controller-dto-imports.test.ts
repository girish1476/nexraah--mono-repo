import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A request body or query class must reach a controller as a value.
 *
 * The validator learns which class to check a body against from the type the
 * compiler records for that parameter. `import type` erases the class, the
 * recorded type becomes `Function`, and the validator — with
 * `forbidNonWhitelisted` — then refuses every field the request carries. That
 * is how the portal's POD upload, bill and selfie were all refused on a real
 * server while every test passed: the test runner (esbuild) records no
 * parameter types at all, so it cannot see this at run time. The source can.
 */
const MODULES = join(__dirname, '..', 'modules');

function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? controllers(join(dir, e.name)) : e.name.endsWith('.controller.ts') ? [join(dir, e.name)] : [],
  );
}

function typeOnlyNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/import\s+type\s*\{([^}]*)\}/g)) {
    m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!).filter(Boolean).forEach((n) => names.add(n));
  }
  for (const m of source.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().match(/^type\s+(\w+)(?:\s+as\s+(\w+))?/);
      if (t) names.add(t[2] ?? t[1]);
    }
  }
  return names;
}

describe('controllers import the classes they validate requests with', () => {
  const files = controllers(MODULES);

  it('finds the controllers', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(file.slice(MODULES.length + 1).split('\\').join('/'), () => {
      const source = readFileSync(file, 'utf8');
      const typeOnly = typeOnlyNames(source);
      const validated = [...source.matchAll(/@(?:Body|Query)\(\)\s+\w+\??\s*:\s*(\w+)/g)].map((m) => m[1]);
      expect(validated.filter((name) => typeOnly.has(name))).toEqual([]);
    });
  }
});
