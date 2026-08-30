/** Small async primitives shared by the crawler and the image mirror. */

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Full jitter exponential backoff (AWS's recommended variant).
 * Spreading retries avoids synchronised retry storms against the source site.
 */
export function backoffDelayMs(
  attempt: number,
  options: { baseMs: number; maxMs: number; random?: () => number },
): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt));
  const random = options.random ?? Math.random;
  return Math.floor(random() * exponential);
}

export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly signal?: AbortSignal;
  readonly random?: () => number;
  /** Return false to stop retrying immediately (e.g. a 404). */
  readonly isRetryable?: (error: unknown) => boolean;
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  const total = Math.max(1, options.attempts);
  for (let attempt = 0; attempt < total; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.isRetryable ? options.isRetryable(error) : true;
      const isLast = attempt === total - 1;
      if (!retryable || isLast) break;
      const delayMs = backoffDelayMs(attempt, {
        baseMs: options.baseDelayMs,
        maxMs: options.maxDelayMs,
        ...(options.random ? { random: options.random } : {}),
      });
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }
  throw lastError;
}

/**
 * Run tasks with bounded concurrency, preserving input order in the results.
 * Never rejects on individual task failure: each slot resolves to a
 * settled-style record so one bad page cannot abort a whole crawl.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<Array<Settled<TOut>>> {
  const results = new Array<Settled<TOut>>(items.length);
  const limit = Math.max(1, Math.floor(concurrency));
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index] as TIn;
      try {
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

/** A simple deadline helper so long jobs can stop before a Lambda timeout. */
export class Deadline {
  private readonly endsAt: number;

  constructor(
    budgetMs: number,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.endsAt = this.clock() + budgetMs;
  }

  get remainingMs(): number {
    return Math.max(0, this.endsAt - this.clock());
  }

  get expired(): boolean {
    return this.remainingMs <= 0;
  }
}
