/*
 * The barrel is imported by the storefront's client components (the search
 * field in every page's header, the cart), so everything it exports ends up in
 * the browser, and it must not import anything that needs Node.
 *
 * `hash.ts` is therefore not here. It imports `node:crypto`, and Turbopack
 * answers that in a browser bundle with crypto-browserify: about 107 KB of
 * brotli on every page of buy-a-coffee.com, a third of its JavaScript, and a
 * CSP `'unsafe-eval'` report on every load from a generator check inside it
 * (measured 20 October 2026). Its users are the sync and the scripts, which
 * import `@catalog/shared/hash`. `apps/web/test/client-imports.test.ts` walks
 * every client module's imports and fails if one reaches Node again.
 *
 * `logger.ts` stays: it imports nothing, and touches `process.stdout` only
 * when a line is written without a `write` of the caller's. The package's
 * `"sideEffects": false` lets a bundle leave it out all the same: without it,
 * `silentLogger`'s top-level call kept the logger in every page's JavaScript
 * although no client module uses it.
 */
export * from "./async.ts";
export * from "./decimal.ts";
export * from "./logger.ts";
export * from "./money.ts";
export * from "./serving.ts";
export * from "./unit-price.ts";
export * from "./text.ts";
export * from "./url.ts";
export * from "./weight.ts";
export * from "./pack-size.ts";
export * from "./product-kind.ts";
export * from "./product-name.ts";
export * from "./product-slug.ts";
export * from "./copy-originality.ts";
