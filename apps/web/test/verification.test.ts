import { describe, expect, it } from "vitest";
import { siteVerification } from "@/lib/seo/verification";

/*
 * Search Console and Bing ownership tags (`lib/seo/verification.ts`): printed
 * only when the owner has supplied a token, and only the token.
 */

describe("site verification", () => {
  it("prints nothing while no token is set", () => {
    expect(siteVerification({})).toBeUndefined();
    expect(
      siteVerification({ GOOGLE_SITE_VERIFICATION: "  ", BING_SITE_VERIFICATION: "" }),
    ).toBeUndefined();
  });

  it("prints Google's tag alone when only Google's token is set", () => {
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "abc123DEF_456-x" })).toEqual({
      google: "abc123DEF_456-x",
    });
  });

  it("prints Bing's as msvalidate.01", () => {
    expect(siteVerification({ BING_SITE_VERIFICATION: "0123456789ABCDEF" })).toEqual({
      other: { "msvalidate.01": "0123456789ABCDEF" },
    });
  });

  it("prints both when both are set", () => {
    expect(
      siteVerification({ GOOGLE_SITE_VERIFICATION: "g-token", BING_SITE_VERIFICATION: "b-token" }),
    ).toEqual({ google: "g-token", other: { "msvalidate.01": "b-token" } });
  });

  it("takes the token out of a whole pasted tag, and refuses anything that is not one", () => {
    expect(
      siteVerification({
        GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="g-token" />',
      }),
    ).toEqual({ google: "g-token" });
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "two words" })).toBeUndefined();
  });
});
