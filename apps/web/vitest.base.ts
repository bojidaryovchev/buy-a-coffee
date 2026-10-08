import path from "node:path";

/**
 * What every storefront test run shares: the JSX runtime and the module aliases.
 *
 * In its own file, and not in `vitest.config.ts`, because the root config
 * builds the storefront's unit and integration projects from it. A project
 * that `extends` a config file has its `include` arrays concatenated with the
 * file's, not replaced, so the file the projects extend cannot name tests.
 */
export const webBase = {
  /*
   * Compile JSX with the automatic runtime, as Next.js does. Without it a
   * component under test needs `React` in scope, which no component here has.
   */
  esbuild: { jsx: "automatic" as const },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      /**
       * `server-only` throws on import outside a Next.js server context, which
       * is exactly its job — but it also means server modules cannot be unit
       * tested. Aliasing it to an empty module keeps the guard in the real
       * build while letting the tests exercise the code it protects.
       */
      "server-only": path.resolve(import.meta.dirname, "./test/stubs/server-only.ts"),
    },
  },
};
