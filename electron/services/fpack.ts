import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { app } from "electron";
import { once } from "node:events";
import yauzl from "yauzl";
import { getStore } from "./store";
import { FPACK_EXTRACTION_PATH_KEY } from "../../src/constants/fpackSettings";

export function isFpackFile(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(".fpack");
}

export async function extractFpack(fpackPath: string, destDir: string): Promise<string> {
  await fs.mkdir(destDir, { recursive: true });

  return new Promise<string>((resolve, reject) => {
    yauzl.open(fpackPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new Error(`Failed to open .fpack file: ${err.message}`));
        return;
      }
      if (!zipfile) {
        reject(new Error("Failed to open .fpack file: no zipfile handle."));
        return;
      }

      zipfile.on("error", (zipErr) => {
        reject(new Error(`Failed to read .fpack file: ${zipErr.message}`));
      });

      zipfile.on("end", () => {
        resolve(destDir);
      });

      zipfile.on("entry", (entry) => {
        const entryPath = path.resolve(destDir, entry.fileName);
        const resolvedDest = path.resolve(destDir);
        if (!entryPath.startsWith(resolvedDest + path.sep) && entryPath !== resolvedDest) {
          zipfile.readEntry();
          return;
        }

        if (/\/$/.test(entry.fileName)) {
          fs.mkdir(entryPath, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch((mkdirErr) =>
              reject(
                new Error(
                  `Failed to create directory ${entry.fileName}: ${mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)}`
                )
              )
            );
          return;
        }

        const parentDir = path.dirname(entryPath);
        fs.mkdir(parentDir, { recursive: true })
          .then(() => {
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr) {
                reject(new Error(`Failed to read entry ${entry.fileName}: ${streamErr.message}`));
                return;
              }
              if (!readStream) {
                reject(new Error(`Failed to read entry ${entry.fileName}: no stream.`));
                return;
              }

              const writeStream = createWriteStream(entryPath);
              readStream.on("error", (readErr) => {
                reject(new Error(`Failed to extract ${entry.fileName}: ${readErr.message}`));
              });
              writeStream.on("error", (writeErr) => {
                reject(new Error(`Failed to write ${entry.fileName}: ${writeErr.message}`));
              });
              writeStream.on("close", () => {
                zipfile.readEntry();
              });
              readStream.pipe(writeStream);
            });
          })
          .catch((mkdirErr) => {
            reject(
              new Error(
                `Failed to create directory for ${entry.fileName}: ${mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)}`
              )
            );
          });
      });

      zipfile.readEntry();
    });
  });
}

export async function extractFpackToTemp(
  fpackPath: string
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const tempBase = app.getPath("temp");
  const tempDir = path.join(
    tempBase,
    `fpack-extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  await extractFpack(fpackPath, tempDir);

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  return { dir: tempDir, cleanup };
}

export async function getFpackExtractionRoot(): Promise<string> {
  const store = getStore();
  const configuredPath = store.get(FPACK_EXTRACTION_PATH_KEY);

  if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
    return path.resolve(configuredPath.trim());
  }

  // Default to a persistent folder in userData
  return path.join(app.getPath("userData"), "fpacks");
}

export async function extractFpackToPersistent(fpackPath: string): Promise<{ dir: string }> {
  const root = await getFpackExtractionRoot();
  const destDir = path.join(
    root,
    `fpack-extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  await extractFpack(fpackPath, destDir);

  return { dir: destDir };
}

export async function createFpackFromDirectory(dirPath: string, outputPath: string): Promise<void> {
  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const done = once(output, "close");

  archive.pipe(output);
  archive.directory(dirPath, false);
  await archive.finalize();

  await done;
}
