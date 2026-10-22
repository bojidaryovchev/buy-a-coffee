import { sleep } from "@catalog/shared";

/**
 * The background-removal model: BRIA RMBG 2.0, run by fal — DESIGN.md,
 * "Imagery"; docs/decisions.md, "BRIA through fal".
 *
 * One call per photo. fal fetches the photo from its public address in our
 * store and answers with it cut out, as a PNG of the photo's own size, inline
 * (`sync_mode`), so the result is not kept in fal's request history. Only its
 * alpha is used: `tools/cutout` levels, checks and trims as before.
 *
 * The key is read from the environment by the caller and lives here only;
 * the Python tool never sees it, and no message this module makes contains it:
 * a failed request is described by its kind and fal's own answer, never by the
 * request. fal is prepaid: an account with no credit, or a key it does not
 * accept, refuses every call alike, so that is not one photo's failure but the
 * run's (`ModelAccountError`).
 */

export const MODEL_NAME = "fal-ai/bria/background/remove";
export const MODEL_ENDPOINT = `https://fal.run/${MODEL_NAME}`;

/** Cuts one photo out; resolves to the model's PNG. Injected in tests. */
export type Segmenter = (photoUrl: string) => Promise<Uint8Array>;

/** fal refused the key or the account (no credit): no photo can be cut until a person acts. */
export class ModelAccountError extends Error {
  override readonly name = "ModelAccountError";
}

/** One call that did not give a cut-out; `status` is fal's HTTP status, if it answered. */
export class ModelError extends Error {
  override readonly name = "ModelError";
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** A fal key: its id, a colon, its secret — nothing that cannot go in a header. */
const KEY_SHAPE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

export function isFalKey(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export interface FalSegmenterOptions {
  readonly key: string;
  readonly fetchImpl?: typeof fetch;
  /** Per request; a photo takes about 3 s. */
  readonly timeoutMs?: number;
  /** Tries for a busy or failing service (HTTP 429, 5xx, no answer). */
  readonly attempts?: number;
  /** The first pause between tries; each next one is four times longer. */
  readonly pauseMs?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** fal's own words about a refusal, short and on one line. */
async function detail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/\s+/g, " ").slice(0, 200);
}

/** A request that got no answer, by kind only: its message could quote the request. */
function unreachable(error: unknown): ModelError {
  const kind = error instanceof Error ? error.name : "error";
  return new ModelError(`fal could not be reached (${kind})`, null);
}

export function falSegmenter(options: FalSegmenterOptions): Segmenter {
  if (!isFalKey(options.key)) {
    throw new ModelAccountError("FAL_KEY is not a fal key (its id, a colon, its secret)");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const attempts = Math.max(1, options.attempts ?? 3);
  const pauseMs = options.pauseMs ?? 2_000;

  /** The answer's picture: inline as a data URI, or at an address on fal's CDN. */
  async function picture(url: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      if (comma < 0 || !url.slice(0, comma).endsWith(";base64")) {
        throw new ModelError("fal answered with a data URI that is not base64", null);
      }
      bytes = new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
    } else if (url.startsWith("https://")) {
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        throw unreachable(error);
      }
      if (!response.ok) {
        throw new ModelError(
          `the cut-out could not be fetched (HTTP ${response.status})`,
          response.status,
        );
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      throw new ModelError("fal answered with no usable picture address", null);
    }
    if (!isPng(bytes)) throw new ModelError("fal answered with something other than a PNG", null);
    return bytes;
  }

  return async (photoUrl) => {
    let lastError: ModelError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await sleep(pauseMs * 4 ** (attempt - 2));
      let response: Response;
      try {
        response = await fetchImpl(MODEL_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Key ${options.key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ image_url: photoUrl, sync_mode: true }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = unreachable(error);
        continue;
      }
      if ([401, 402, 403].includes(response.status)) {
        throw new ModelAccountError(
          `fal refused the account (HTTP ${response.status}): ${await detail(response)}`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new ModelError(
          `fal answered HTTP ${response.status}: ${await detail(response)}`,
          response.status,
        );
        continue;
      }
      if (!response.ok) {
        throw new ModelError(
          `fal answered HTTP ${response.status}: ${await detail(response)}`,
          response.status,
        );
      }
      const answer = (await response.json().catch(() => null)) as {
        image?: { url?: unknown };
      } | null;
      const url = answer?.image?.url;
      if (typeof url !== "string") throw new ModelError("fal answered with no image", null);
      return picture(url);
    }
    throw lastError ?? new ModelError("fal gave no answer", null);
  };
}
