import { FoundationError } from "../error.js";
import { git } from "../repository/git.js";

export async function exactBlobSizes(
  repository: string,
  objectIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const unique = [...new Set(objectIds)].sort();
  if (unique.length === 0) return new Map();
  const result = await git(repository, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: `${unique.join("\n")}\n`,
    maxStdoutBytes: Math.max(1024, unique.length * 160),
  });
  const lines = result.stdout.trimEnd().split("\n");
  if (lines.length !== unique.length) {
    throw new FoundationError("lifecycle.projection.content-digest", "Git returned an incomplete exact object-size inventory");
  }
  const values = new Map<string, number>();
  for (const line of lines) {
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob ([0-9]+)$/u.exec(line);
    if (match === null) {
      throw new FoundationError("lifecycle.projection.content-digest", "Projection input names a missing or non-blob Git object", {
        observedFacts: { response: line },
      });
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new FoundationError("lifecycle.projection.content-digest", "Git blob size is not one nonnegative safe integer");
    }
    values.set(match[1]!, size);
  }
  return values;
}
