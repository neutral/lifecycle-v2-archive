import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { FoundationExecutionBackend } from "../../src/foundation/execution/backend.js";
import type { FoundationExecutionBackendProfileV1 } from "../../src/foundation/execution/contracts.js";
import { canonicalJsonLine } from "../../src/foundation/validation/canonical.js";
import {
  InMemoryExecutionBackendEngine,
  type InMemoryExecutionBackendSnapshotV1,
} from "./in-memory-execution-backend.js";

export type ConnectedBackendMethod = Exclude<keyof FoundationExecutionBackend, "profile">;

export type ConnectedBackendCall = Readonly<{
  sequence: number;
  method: ConnectedBackendMethod;
  outcome: "returned" | "threw";
  handle: string | null;
  specificationDigest: string | null;
}>;

export type ConnectedBackendState = Readonly<{
  schema: "lifecycle.connected-test-backend.private.v1";
  engine: InMemoryExecutionBackendSnapshotV1;
  calls: readonly ConnectedBackendCall[];
}>;

/** Test-owned external state, never Runtime checkpoints or finalized Control. */
export async function readConnectedBackendState(path: string): Promise<ConnectedBackendState> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (value === null || typeof value !== "object" ||
      (value as ConnectedBackendState).schema !== "lifecycle.connected-test-backend.private.v1" ||
      !Array.isArray((value as ConnectedBackendState).calls)) {
    throw new TypeError("Connected external Backend snapshot has another shape");
  }
  return value as ConnectedBackendState;
}

async function retainState(path: string, state: ConnectedBackendState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.next`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(canonicalJsonLine(state), "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * One worker at a time owns this fixture. The existing finite physical Engine
 * supplies facts and bytes; its strict reload validates retained allocations.
 * The wrapper records calls and durably saves external state before a parent
 * may kill the worker. It does not model Docker or another independent Engine.
 */
export async function openConnectedDiskBackend(input: Readonly<{
  path: string;
  profile: FoundationExecutionBackendProfileV1;
  afterCall?: (call: ConnectedBackendCall) => Promise<void>;
}>): Promise<Readonly<{
  engine: InMemoryExecutionBackendEngine;
  wrapBackend(backend: FoundationExecutionBackend): FoundationExecutionBackend;
}>> {
  let prior: ConnectedBackendState | null = null;
  try {
    prior = await readConnectedBackendState(input.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const engine = prior === null
    ? new InMemoryExecutionBackendEngine("1".repeat(64))
    : InMemoryExecutionBackendEngine.reload(prior.engine, input.profile);
  engine.facade(input.profile);
  const calls: ConnectedBackendCall[] = [...(prior?.calls ?? [])];
  await retainState(input.path, {
    schema: "lifecycle.connected-test-backend.private.v1",
    engine: engine.snapshot(),
    calls,
  });

  async function invoke<T>(
    method: ConnectedBackendMethod,
    selected: Readonly<{ handle?: string; specificationDigest?: string }>,
    action: () => Promise<T>,
  ): Promise<T> {
    let outcome: ConnectedBackendCall["outcome"] = "threw";
    let result: T;
    try {
      result = await action();
      outcome = "returned";
      return result;
    } finally {
      const snapshot = engine.snapshot();
      const allocation = snapshot.allocations.find(({ handle }) => handle === selected.handle) ??
        snapshot.missingAllocations.find(({ handle }) => handle === selected.handle) ??
        snapshot.reclamationTombstones.find(({ handle }) => handle === selected.handle);
      const call: ConnectedBackendCall = Object.freeze({
        sequence: calls.length + 1,
        method,
        outcome,
        handle: selected.handle ?? (method === "allocate" && outcome === "returned"
          ? String(result!) : null),
        specificationDigest: selected.specificationDigest ?? allocation?.specification.digest ?? null,
      });
      calls.push(call);
      await retainState(input.path, {
        schema: "lifecycle.connected-test-backend.private.v1",
        engine: snapshot,
        calls,
      });
      await input.afterCall?.(call);
    }
  }

  return Object.freeze({
    engine,
    wrapBackend(backend: FoundationExecutionBackend): FoundationExecutionBackend {
      const wrapped: FoundationExecutionBackend = {
        profile: backend.profile,
        allocate: (specification, key) => invoke("allocate", {
          specificationDigest: specification.digest,
        }, () => backend.allocate(specification, key)),
        dispatch: (handle) => invoke("dispatch", { handle }, () => backend.dispatch(handle)),
        observe: (handle) => invoke("observe", { handle }, () => backend.observe(handle)),
        cancel: (handle) => invoke("cancel", { handle }, () => backend.cancel(handle)),
        retrieve: (handle, observation) => invoke("retrieve", { handle },
          () => backend.retrieve(handle, observation)),
        createReclamationBinding: (selected) => invoke("createReclamationBinding", {
          handle: selected.handle,
          specificationDigest: selected.specification.digest,
        }, () => backend.createReclamationBinding(selected)),
        reclaim: (specification, binding, obligation) => invoke("reclaim", {
          specificationDigest: specification.digest,
        }, () => backend.reclaim(specification, binding, obligation)),
      };
      return Object.freeze(wrapped);
    },
  });
}
