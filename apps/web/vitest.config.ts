import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
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
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
