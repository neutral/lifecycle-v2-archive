import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { parseDisciplinePack, verifyDisciplinePackRecords } from "../dist/src/foundation/knowledge/discipline-pack.js";
import { FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS as limits } from "../dist/src/foundation/repository/contract.js";

// Repository-operated, read-only validation; no target, Git mutation, network, or authority operation.
async function readRegular(root, relative, maximumBytes) {
  const segments = relative.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Pack record traverses non-directory or symlink content");
  }
  const handle = await open(join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o111) !== 0) throw new Error("Pack content must be non-executable regular files");
    if (metadata.size > maximumBytes) throw new Error("Pack content exceeds its byte limit");
    const bytes = Buffer.alloc(metadata.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length !== metadata.size) throw new Error("Pack content changed while reading");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

try {
  if (process.argv.length !== 3) throw new Error("Usage: node runtime/scripts/validate-discipline-pack.mjs <pack-directory>");
  const root = resolve(process.argv[2]);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Pack root must be one real directory");
  const pack = parseDisciplinePack(await readRegular(root, "pack.json", limits.maximumTotalRecordBytes));
  const records = [];
  let aggregateBytes = 0;
  for (const record of pack.records) {
    const remaining = limits.maximumTotalRecordBytes - aggregateBytes;
    const bytes = await readRegular(root, record.path, Math.min(limits.maximumFileBytes, remaining));
    aggregateBytes += bytes.byteLength;
    records.push({ path: record.path, mode: "100644", bytes });
  }
  verifyDisciplinePackRecords(pack, records);
  process.stdout.write(`${JSON.stringify({
    valid: true,
    pack: { id: pack.id, version: pack.version, publisher: pack.publisher, manifestDigest: pack.digest, contract: pack.contract },
    records: pack.records,
    sets: pack.sets,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ valid: false, code: error.code ?? "lifecycle.discipline.pack-invalid", message: error.message })}\n`);
  process.exitCode = 1;
}
