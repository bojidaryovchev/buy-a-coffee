#!/usr/bin/env node
/**
 * Bundle the Lambda handler into a single deployable zip.
 *
 * esbuild resolves the workspace packages from source, so the artifact needs
 * no `node_modules` at runtime. The AWS SDK is marked external because the
 * Lambda runtime already provides it — bundling it would add megabytes and a
 * second, divergent copy.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const outDir = path.resolve(appRoot, "../../infra/terraform/build");
const bundlePath = path.join(outDir, "handler.mjs");
const zipPath = path.join(outDir, "scraper-lambda.zip");

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(appRoot, "src/lambda.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    minify: false, // Readable stack traces are worth more than a smaller zip.
    treeShaking: true,
    external: ["@aws-sdk/*"],
    banner: {
      // ESM bundles lose CommonJS globals that some dependencies still expect.
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        "const require = __createRequire(import.meta.url);",
      ].join("\n"),
    },
    logLevel: "info",
  });

  const bundleStat = await stat(bundlePath);
  console.log(`bundle: ${bundlePath} (${(bundleStat.size / 1024).toFixed(0)} KB)`);

  await zip(bundlePath, zipPath);
  const zipStat = await stat(zipPath);
  console.log(`zip:    ${zipPath} (${(zipStat.size / 1024).toFixed(0)} KB)`);
}

/**
 * Create the zip with whatever the platform provides: PowerShell on Windows,
 * `zip` elsewhere. Falls back to a minimal stored-entry writer so the build
 * never depends on a tool that may not be installed.
 */
async function zip(inputFile, outputFile) {
  const exec = promisify(execFile);
  const entryName = path.basename(inputFile);

  if (process.platform === "win32") {
    await exec("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${inputFile}' -DestinationPath '${outputFile}' -Force`,
    ]);
    return;
  }
  try {
    await exec("zip", ["-j", "-q", outputFile, inputFile]);
    return;
  } catch {
    console.warn("`zip` unavailable; writing a stored-entry archive");
    await writeStoredZip(inputFile, outputFile, entryName);
  }
}

/** Minimal ZIP writer using stored (uncompressed) entries. */
async function writeStoredZip(inputFile, outputFile, entryName) {
  const { readFile } = await import("node:fs/promises");
  const { crc32 } = await import("node:zlib").then((m) => ({
    crc32: m.crc32 ?? ((buf) => legacyCrc32(buf)),
  }));

  const data = await readFile(inputFile);
  const name = Buffer.from(entryName, "utf8");
  const crc = crc32(data) >>> 0;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // stored
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);

  const centralOffset = localHeader.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  await new Promise((resolve, reject) => {
    const out = createWriteStream(outputFile);
    out.on("error", reject);
    out.on("close", resolve);
    out.write(localHeader);
    out.write(name);
    out.write(data);
    out.write(centralHeader);
    out.write(name);
    out.write(end);
    out.end();
  });
}

function legacyCrc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
