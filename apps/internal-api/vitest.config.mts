import { defineConfig } from 'vitest/config';

/**
 * Test runner for internal-api.
 *
 * This app had none. The integration audit recorded "zero backend tests, no
 * test runner installed" as an open gap, and it is the reason every validation
 * bug found here so far was found by *reading* rather than by *failing* — the
 * portal's fixture adapter does not validate, so a DTO that silently drops a
 * field looks perfectly healthy from the front end.
 *
 * No decorator configuration is needed: vitest 4 transforms with oxc, which
 * handles `experimentalDecorators` from tsconfig on its own. (An earlier
 * version of this file set `esbuild.tsconfigRaw`; vitest warned that oxc was
 * in use and the esbuild options were being ignored, so they are gone.)
 *
 * These tests deliberately do not rely on `emitDecoratorMetadata` either.
 * Every validator in the DTOs is written explicitly — `@IsString()`,
 * `@Type(() => Thing)` — rather than inferred from a reflected type, so the
 * suite exercises the same rules the Nest build enforces.
 *
 * There is no database on this machine, so nothing here touches one. What it
 * covers is the validation boundary: the layer that decides whether a request
 * is allowed to reach a service at all.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
