import { describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";
import {
  VercelBlobStorageDriver,
  createStorageDriver,
  createVercelBlobClient,
} from "../src/storage/driver.ts";
import { FakeBlobClient } from "./helpers/fakeBlobClient.ts";

const sdk = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    put: vi.fn(async () => ({})),
    head: vi.fn(),
    get: vi.fn(),
    del: vi.fn(async () => undefined),
  };
});
vi.mock("@vercel/blob", () => sdk);

describe("VercelBlobStorageDriver", () => {
  it("passes content type and the max-age of Cache-Control to the client", async () => {
    const client = new FakeBlobClient();
    const driver = new VercelBlobStorageDriver("t", "https://s.example", client);
    await driver.put({
      key: "catalog/ab/cd/abcd.jpg",
      body: "x",
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(client.putCalls[0]).toEqual({
      pathname: "catalog/ab/cd/abcd.jpg",
      options: { contentType: "image/jpeg", cacheControlMaxAge: 31536000 },
    });
  });

  it("builds a predictable URL from the base", () => {
    const driver = new VercelBlobStorageDriver("t", "https://s.example/", new FakeBlobClient());
    expect(driver.urlFor("catalog/ab/cd/abcd.jpg")).toBe(
      "https://s.example/catalog/ab/cd/abcd.jpg",
    );
  });

  it("does not report a failing store as a missing object", async () => {
    const client = new FakeBlobClient();
    client.failWith = new Error("401 unauthorised");
    const driver = new VercelBlobStorageDriver("t", "https://s.example", client);
    await expect(driver.exists("a/b.jpg")).rejects.toThrow("401");
  });

  it("does not load the SDK on construction", () => {
    sdk.put.mockClear();
    new VercelBlobStorageDriver("t", "https://s.example");
    expect(sdk.put).not.toHaveBeenCalled();
  });
});

describe("createVercelBlobClient (SDK adapter)", () => {
  it("writes the exact key, public, overwritable, with the token", async () => {
    const client = await createVercelBlobClient("tok");
    await client.put("catalog/a.jpg", Buffer.from("x"), { contentType: "image/jpeg" });
    expect(sdk.put).toHaveBeenCalledWith(
      "catalog/a.jpg",
      expect.any(Buffer),
      expect.objectContaining({
        access: "public",
        token: "tok",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/jpeg",
      }),
    );
  });

  it("maps not-found to null and rethrows other errors", async () => {
    const client = await createVercelBlobClient("tok");
    sdk.head.mockRejectedValueOnce(new sdk.BlobNotFoundError());
    expect(await client.head("x")).toBeNull();
    sdk.head.mockRejectedValueOnce(new Error("boom"));
    await expect(client.head("x")).rejects.toThrow("boom");
    sdk.head.mockResolvedValueOnce({ size: 5 });
    expect(await client.head("x")).toEqual({ size: 5 });
  });

  it("reads bytes from the stream and returns null when absent", async () => {
    const client = await createVercelBlobClient("tok");
    sdk.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response("abc").body });
    expect(Buffer.from((await client.get("x")) as Uint8Array).toString()).toBe("abc");
    sdk.get.mockResolvedValueOnce(null);
    expect(await client.get("x")).toBeNull();
  });
});

describe("configuration", () => {
  const base = { STORAGE_DRIVER: "vercel-blob" };

  it("fails at start-up without a token, naming the variable", () => {
    expect(() => loadConfig({}, { ...base, STORAGE_PUBLIC_BASE_URL: "https://s.example" })).toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
  });

  it("fails at start-up without a public base URL, naming the variable", () => {
    expect(() => loadConfig({}, { ...base, BLOB_READ_WRITE_TOKEN: "t" })).toThrow(ConfigError);
    expect(() => loadConfig({}, { ...base, BLOB_READ_WRITE_TOKEN: "t" })).toThrow(
      /STORAGE_PUBLIC_BASE_URL/,
    );
  });

  it("selects the driver by configuration alone", () => {
    const config = loadConfig(
      {},
      { ...base, BLOB_READ_WRITE_TOKEN: "t", STORAGE_PUBLIC_BASE_URL: "https://s.example" },
    );
    expect(createStorageDriver(config).kind).toBe("vercel-blob");
  });

  it("createStorageDriver also refuses an incomplete configuration", () => {
    expect(() =>
      createStorageDriver({
        storageDriver: "vercel-blob",
        storageLocalDir: ".storage",
        storagePublicBaseUrl: "",
        s3Bucket: "",
        s3Region: "",
        s3Prefix: "",
      }),
    ).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });
});
