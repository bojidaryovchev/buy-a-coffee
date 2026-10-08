import { describe, expect, it } from "vitest";
import type { StorageDriver } from "../../src/storage/driver.ts";

interface ContractSubject {
  readonly driver: StorageDriver;
  readonly publicBaseUrl: string | null;
}

/**
 * The behaviour every StorageDriver must have. Run it from a test file with a
 * factory. Keys carry a per-run prefix so runs against a shared remote store
 * cannot collide.
 */
export function describeStorageContract(
  name: string,
  create: () => Promise<ContractSubject> | ContractSubject,
  options: { skip?: boolean } = {},
): void {
  const suite = options.skip ? describe.skip : describe;
  suite(`StorageDriver contract: ${name}`, () => {
    const run = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const keyA = `${run}/aa/bb/object-a.txt`;
    const keyB = `${run}/aa/bb/object-b.txt`;
    const bytes = new TextEncoder().encode("hello contract");
    const accented = "café";

    it("put, exists, get and delete round-trip", async () => {
      const { driver } = await create();
      expect(await driver.exists(keyA)).toBe(false);
      expect(await driver.get(keyA)).toBeNull();

      const stored = await driver.put({ key: keyA, body: bytes, contentType: "text/plain" });
      expect(stored.key).toBe(keyA);
      expect(stored.size).toBe(bytes.byteLength);

      expect(await driver.exists(keyA)).toBe(true);
      const read = await driver.get(keyA);
      expect(read).not.toBeNull();
      expect(Buffer.from(read as Uint8Array).toString("utf8")).toBe("hello contract");

      await driver.delete(keyA);
      expect(await driver.exists(keyA)).toBe(false);
      expect(await driver.get(keyA)).toBeNull();
    });

    it("accepts string bodies", async () => {
      const { driver } = await create();
      const stored = await driver.put({ key: keyB, body: accented, contentType: "text/plain" });
      expect(stored.size).toBe(Buffer.byteLength(accented));
      expect(Buffer.from((await driver.get(keyB)) as Uint8Array).toString("utf8")).toBe(accented);
      await driver.delete(keyB);
    });

    it("overwriting the same key with the same bytes is harmless", async () => {
      const { driver } = await create();
      const key = `${run}/overwrite.txt`;
      await driver.put({ key, body: bytes, contentType: "text/plain" });
      await expect(
        driver.put({ key, body: bytes, contentType: "text/plain" }),
      ).resolves.toMatchObject({ key, size: bytes.byteLength });
      expect(Buffer.from((await driver.get(key)) as Uint8Array).toString("utf8")).toBe(
        "hello contract",
      );
      await driver.delete(key);
    });

    it("deleting an absent key does not throw", async () => {
      const { driver } = await create();
      await expect(driver.delete(`${run}/never-existed.txt`)).resolves.toBeUndefined();
    });

    it("urlFor is the public base URL plus the key", async () => {
      const { driver, publicBaseUrl } = await create();
      if (publicBaseUrl === null) {
        expect(driver.urlFor(keyA)).toBeNull();
        return;
      }
      expect(driver.urlFor(keyA)).toBe(`${publicBaseUrl.replace(/\/+$/, "")}/${keyA}`);
    });

    it("rejects unsafe keys on every operation", async () => {
      const { driver } = await create();
      for (const key of ["", "/abs", "../escape", "a/../b", "a\\b"]) {
        await expect(driver.put({ key, body: bytes })).rejects.toThrow(/Unsafe object key/);
        await expect(driver.exists(key)).rejects.toThrow(/Unsafe object key/);
        await expect(driver.get(key)).rejects.toThrow(/Unsafe object key/);
        await expect(driver.delete(key)).rejects.toThrow(/Unsafe object key/);
        expect(() => driver.urlFor(key)).toThrow(/Unsafe object key/);
      }
    });
  });
}
