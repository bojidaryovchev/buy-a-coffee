import { useEffect, useSyncExternalStore } from "react";

/**
 * Work that waits until the page has loaded: the scroll-driven motion
 * (`MotionGate`) and the code behind the header's controls, which nobody can
 * use in the first second and every page used to download before its load
 * event.
 *
 * Simulated slow 4G — PageSpeed Insights' phone — charges the first paint for
 * every byte requested before it. A module imported here is not one of them:
 * it is fetched on the first idle moment after `load`, or at once when the
 * visitor reaches for the control it serves, whichever comes first.
 */

/**
 * Run `run` on the first idle moment after the page's `load` event, at most
 * `timeout` ms after it on a main thread that never idles. Where there is no
 * `requestIdleCallback` (Safari), shortly after `load`. Returns a cancel.
 */
export function afterLoadIdle(run: () => void, timeout = 2000): () => void {
  let idle: number | undefined;
  let timer: number | undefined;
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout });
    } else {
      timer = window.setTimeout(run, 200);
    }
  };

  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });

  return () => {
    window.removeEventListener("load", schedule);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/**
 * A module fetched on demand, once per visit, whoever asks first.
 *
 * Declared at module scope around a literal `import()` — the bundler can only
 * split off what it can see — so every instance of a control shares one
 * download, and a control mounted after it arrived (the search page's field,
 * after the header's) has it from its first render.
 */
export interface DeferredModule<T> {
  /** The module once it has arrived; undefined until then. */
  readonly current: () => T | undefined;
  /**
   * Start the import, or join the one under way. A failed import (a dropped
   * connection) is forgotten, so the next interaction tries again.
   */
  readonly load: () => Promise<T>;
  readonly subscribe: (listener: () => void) => () => void;
}

export function deferredModule<T>(importer: () => Promise<T>): DeferredModule<T> {
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  const listeners = new Set<() => void>();
  return {
    current: () => loaded,
    load: () =>
      (pending ??= importer().then(
        (module) => {
          loaded = module;
          for (const listener of listeners) listener();
          return module;
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      )),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const notOnTheServer = () => undefined;

/**
 * The module, once it is here; undefined on the server, while hydrating and
 * until it arrives. Asks for it on the first idle moment after `load`, unless
 * `wanted` says the control is not on this screen (the drawer's trigger is
 * hidden on a desktop). The caller adds the interaction that cannot wait:
 * `module.load()` from a focus, `pointerdown` or key handler.
 *
 * Read through `useSyncExternalStore`, so the render that draws the arrived
 * module is a synchronous one: it reads the field and swaps in the panel in
 * one task, with no keystroke in between.
 */
export function useDeferredModule<T>(
  module: DeferredModule<T>,
  wanted: () => boolean = () => true,
): T | undefined {
  const current = useSyncExternalStore(module.subscribe, module.current, notOnTheServer);

  useEffect(() => {
    if (module.current()) return;
    return afterLoadIdle(() => {
      // Nothing to do with a failure here: the control works without it, and
      // the next interaction asks again.
      if (wanted()) module.load().catch(() => undefined);
    });
    // `wanted` is read once, when the moment comes; it need not be stable.
  }, [module]);

  return current;
}
