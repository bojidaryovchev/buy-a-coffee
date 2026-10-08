import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import {
  LocalStorageDriver,
  S3StorageDriver,
  VercelBlobStorageDriver,
} from "../src/storage/driver.ts";
import { FakeBlobClient } from "./helpers/fakeBlobClient.ts";
import { describeStorageContract } from "./helpers/storageContract.ts";

/**
 * Local always runs, and so does the Blob driver against a fake client (it
 * covers the driver's own logic). Real remote stores run only when their
 * credentials are in the environment; otherwise they are reported as skipped.
 */

const BASE = "http://localhost:3000/media";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storage-contract-"));
  dirs.push(dir);
  return dir;
}

describeStorageContract("local", async () => ({
  driver: new LocalStorageDriver(await tempDir(), BASE),
  publicBaseUrl: BASE,
}));

describeStorageContract("local without a public base URL", async () => ({
  driver: new LocalStorageDriver(await tempDir(), null),
  publicBaseUrl: null,
}));

describeStorageContract("vercel-blob (fake client)", () => ({
  driver: new VercelBlobStorageDriver("test-token", "https://store.example/", new FakeBlobClient()),
  publicBaseUrl: "https://store.example",
}));

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const blobBase = process.env.STORAGE_PUBLIC_BASE_URL;
describeStorageContract(
  "vercel-blob (real store)",
  () => ({
    driver: new VercelBlobStorageDriver(blobToken as string, blobBase as string),
    publicBaseUrl: blobBase as string,
  }),
  { skip: !(blobToken && blobBase) },
);

const s3Bucket = process.env.S3_BUCKET;
describeStorageContract(
  "s3 (real bucket)",
  () => {
    const base = process.env.STORAGE_PUBLIC_BASE_URL || null;
    return {
      driver: new S3StorageDriver(
        s3Bucket as string,
        process.env.AWS_REGION ?? "eu-central-1",
        base,
        process.env.S3_PREFIX ?? "",
      ),
      publicBaseUrl: base,
    };
  },
  { skip: !s3Bucket },
);
