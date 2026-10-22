import { describe, expect, it } from "vitest";
import {
  MODEL_ENDPOINT,
  ModelAccountError,
  ModelError,
  falSegmenter,
} from "../src/cutout-model.ts";

/**
 * The call to BRIA on fal, against a stand-in for `fetch`: what is sent, how
 * either form of answer is read, what is tried again and what stops a run.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PHOTO = "https://store.test/catalog/ab/cd/photo.jpg";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers from a list, in order, and remembers every request. */
function scripted(...answers: Array<Response | Error>) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error("no answer scripted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const inline = () =>
  json(200, { image: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` } });

describe("falSegmenter", () => {
  it("will not use a key that cannot be one, and does not repeat it", () => {
    for (const key of ["", "no-colon", "id:s3cr3t-value\nInjected: header", "id:s3cr3t value"]) {
      let thrown: unknown = null;
      try {
        falSegmenter({ key, pauseMs: 0 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ModelAccountError);
      expect(String((thrown as Error).message)).not.toContain("s3cr3t");
    }
  });

  it("describes a request that got no answer by its kind, never by the request", async () => {
    const { fetchImpl } = scripted(
      new TypeError('Headers.append: "Key id:s3cr3t-value" is an invalid header value'),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    );
    const call = falSegmenter({ key: "id:s3cr3t-value", fetchImpl, pauseMs: 0 })(PHOTO);
    await expect(call).rejects.toBeInstanceOf(ModelError);
    await expect(call).rejects.toThrow("fal could not be reached (TypeError)");
    await expect(call).rejects.not.toThrow("s3cr3t");
  });

  it("sends the photo's address with the key, and reads an inline answer", async () => {
    const { fetchImpl, requests } = scripted(inline());
    const bytes = await falSegmenter({ key: "id:secret", fetchImpl, pauseMs: 0 })(PHOTO);
    expect(Array.from(bytes)).toEqual(Array.from(PNG));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(MODEL_ENDPOINT);
    expect(requests[0]!.init?.method).toBe("POST");
    expect(new Headers(requests[0]!.init?.headers).get("authorization")).toBe("Key id:secret");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      image_url: PHOTO,
      sync_mode: true,
    });
  });

  it("fetches an answer given as an address on fal's CDN", async () => {
    const { fetchImpl, requests } = scripted(
      json(200, { image: { url: "https://v3.fal.media/files/cut.png" } }),
      new Response(PNG, { status: 200 }),
    );
    const bytes = await falSegmenter({ key: "id:secret", fetchImpl, pauseMs: 0 })(PHOTO);
    expect(Array.from(bytes)).toEqual(Array.from(PNG));
    expect(requests[1]!.url).toBe("https://v3.fal.media/files/cut.png");
    // The key goes to fal's API only, never to the CDN.
    expect(new Headers(requests[1]!.init?.headers).get("authorization")).toBeNull();
  });

  it("tries a busy or failing service again, then gives up", async () => {
    const busy = scripted(json(429, { detail: "busy" }), json(503, {}), inline());
    await expect(
      falSegmenter({ key: "id:secret", fetchImpl: busy.fetchImpl, pauseMs: 0 })(PHOTO),
    ).resolves.toBeInstanceOf(Uint8Array);
    expect(busy.requests).toHaveLength(3);

    const down = scripted(new Error("socket hang up"), json(502, {}), json(500, {}));
    await expect(
      falSegmenter({ key: "id:secret", fetchImpl: down.fetchImpl, pauseMs: 0 })(PHOTO),
    ).rejects.toThrow("HTTP 500");
    expect(down.requests).toHaveLength(3);
  });

  it("stops at once when fal refuses the account or the key", async () => {
    for (const status of [401, 402, 403]) {
      const { fetchImpl, requests } = scripted(
        json(status, { detail: "User is locked. Reason: TOP_UP." }),
      );
      const call = falSegmenter({ key: "id:secret", fetchImpl, pauseMs: 0 })(PHOTO);
      await expect(call).rejects.toBeInstanceOf(ModelAccountError);
      await expect(call).rejects.toThrow("TOP_UP");
      expect(requests).toHaveLength(1);
    }
  });

  it("does not try a request fal turned down as such again", async () => {
    const { fetchImpl, requests } = scripted(json(422, { detail: "image_url unreachable" }));
    await expect(falSegmenter({ key: "id:secret", fetchImpl, pauseMs: 0 })(PHOTO)).rejects.toThrow(
      "HTTP 422",
    );
    expect(requests).toHaveLength(1);
  });

  it("refuses an answer that is not a PNG", async () => {
    const notPng = Buffer.from("<html>").toString("base64");
    const { fetchImpl } = scripted(
      json(200, { image: { url: `data:image/png;base64,${notPng}` } }),
    );
    await expect(falSegmenter({ key: "id:secret", fetchImpl, pauseMs: 0 })(PHOTO)).rejects.toThrow(
      "other than a PNG",
    );
    const { fetchImpl: empty } = scripted(json(200, {}));
    await expect(
      falSegmenter({ key: "id:secret", fetchImpl: empty, pauseMs: 0 })(PHOTO),
    ).rejects.toThrow("no image");
  });
});
