import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "../e2e/support/database";

/**
 * The end-to-end suite's database guard (`e2e/support/database.ts`): a spec
 * that cleans up after itself deletes rows, so it refuses before connecting
 * to anything that is not on this machine — unless it runs in CI.
 */
describe("the e2e database guard", () => {
  it("lets a local database through", () => {
    expect(() =>
      assertLocalDatabase("postgres://catalog:catalog@localhost:5433/catalog_np_b", ""),
    ).not.toThrow();
    expect(() => assertLocalDatabase("postgres://u:p@127.0.0.1:5432/db", "")).not.toThrow();
  });

  it("refuses anything else, before connecting", () => {
    expect(() =>
      assertLocalDatabase("postgres://u:p@ep-cool-name.eu-central-1.aws.neon.tech/db", ""),
    ).toThrow(/neon\.tech/);
    expect(() => assertLocalDatabase("not a url", "")).toThrow(/not a URL/);
  });

  it("trusts CI, which brings its own database", () => {
    expect(() => assertLocalDatabase("postgres://u:p@postgres:5432/db", "true")).not.toThrow();
  });
});
