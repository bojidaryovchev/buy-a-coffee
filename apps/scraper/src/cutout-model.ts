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
 * the Python tool never sees it. fal is prepaid: an account with no credit, or
 * a key it does not accept, refuses every call alike, so that is not one
 * photo's failure but the run's (`ModelAccountError`), and no attempt is spent.
 */

export const MODEL_NAME = "fal-ai/bria/background/remove";
export const MODEL_ENDPOINT = `https://fal.run/${MODEL_NAME}`;

/** Cuts one photo out; resolves to the model's PNG. Injected in tests. */
export type Segmenter = (photoUrl: string) => Promise<Uint8Array>;

/** fal refused the key or the account (no credit): no photo can be cut until a person acts. */
export class ModelAccountError extends Error {
  override readonly name = "ModelAccountError";
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

async function detail(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 300);
}

export function falSegmenter(options: FalSegmenterOptions): Segmenter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const attempts = Math.max(1, options.attempts ?? 3);
  const pauseMs = options.pauseMs ?? 2_000;

  /** The answer's picture: inline as a data URI, or at an address on fal's CDN. */
  async function picture(url: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      if (comma < 0 || !url.slice(0, comma).endsWith(";base64")) {
        throw new Error("fal answered with a data URI that is not base64");
      }
      bytes = new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
    } else if (url.startsWith("https://")) {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok)
        throw new Error(`the cut-out could not be fetched (HTTP ${response.status})`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      throw new Error("fal answered with no usable picture address");
    }
    if (!isPng(bytes)) throw new Error("fal answered with something other than a PNG");
    return bytes;
  }

  return async (photoUrl) => {
    let lastError: unknown = null;
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
        lastError = error;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ModelAccountError(
          `fal refused the request (HTTP ${response.status}): ${await detail(response)}`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`fal answered HTTP ${response.status}: ${await detail(response)}`);
        continue;
      }
      if (!response.ok) {
        throw new Error(`fal answered HTTP ${response.status}: ${await detail(response)}`);
      }
      const answer = (await response.json()) as { image?: { url?: unknown } };
      const url = answer.image?.url;
      if (typeof url !== "string") throw new Error("fal answered with no image");
      return picture(url);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}
