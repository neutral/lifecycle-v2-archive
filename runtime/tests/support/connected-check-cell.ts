import assert from "node:assert/strict";
import {
  FoundationCheckCellInputTransportRegistryV1,
  type FoundationCheckCellOperationRequestV1,
  type FoundationCheckCellOperatorV1,
  type FoundationCheckCellRuntimeV1,
} from "../../src/foundation/check/execution-cell-v1.js";
import { privateFoundationExecutionHandle, type FoundationExecutionBackend, type FoundationExecutionHandle } from "../../src/foundation/execution/backend.js";
import { parseFoundationExecutionBackendProfile, type FoundationExecutionSpecificationV1 } from "../../src/foundation/execution/contracts.js";
import { FoundationDockerExecutionBindingRegistryV1 } from "../../src/foundation/execution/docker-binding-registry-v1.js";
import { createFoundationCheckCellOperatorV1 } from "../../src/foundation/execution/installed-check-runtime-v1.js";
import { createFoundationExecutionOutputStoreV1 } from "../../src/foundation/execution/output-store-v1.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { checkExecutionOutput } from "./check-cell-output-fixture.js";
import { executionContractFixture } from "./execution-contract-fixture.js";
import { InMemoryExecutionBackendEngine, type InMemoryExecutionBackendSnapshotV1 } from "./in-memory-execution-backend.js";

/** Supplied external Check responses; no Receipt, Seal or Evidence is fabricated. */
export async function createConnectedCheckOperator(input: Readonly<{
  machineHome: string;
  now(): string;
  installationId?: string;
  /** Reload supplied physical facts independently from reopened Runtime owners. */
  engineSnapshot?: unknown;
  afterAllocate?: (specification: FoundationExecutionSpecificationV1) => void;
  response?: (request: FoundationCheckCellOperationRequestV1) => Readonly<{ exitCode: number; stdout?: string }>;
}>): Promise<Readonly<{
  operator: FoundationCheckCellOperatorV1;
  /** Exact resources also used by this operator, for pre-opening reservation. */
  resources: Pick<FoundationCheckCellRuntimeV1, "profile" | "image">;
  dispatchCount(): number;
  specifications(): readonly FoundationExecutionSpecificationV1[];
  engineSnapshot(): InMemoryExecutionBackendSnapshotV1;
  close(): void;
}>> {
  const fixture = executionContractFixture("connected-check");
  const profileSubject = { ...fixture.profile, limits: { ...fixture.profile.limits,
    maximumStorageBytes: 256 * 1024 * 1024 } };
  const profile = parseFoundationExecutionBackendProfile({ ...profileSubject, digest: selfDigest(profileSubject) });
  const image = Object.freeze({
    ...fixture.image,
    runnerContractDigest: sha256Bytes("connected-check-runner-contract"),
    runnerImplementationDigest: sha256Bytes("connected-check-runner-implementation"),
    toolInventoryDigest: sha256Bytes("connected-check-tool-inventory"),
  });
  const clock = Object.freeze({ now: input.now });
  const engine = input.engineSnapshot === undefined
    ? new InMemoryExecutionBackendEngine("4".repeat(64))
    : InMemoryExecutionBackendEngine.reload(input.engineSnapshot, profile);
  const bindingRegistry = new FoundationDockerExecutionBindingRegistryV1();
  const delegate = engine.facade(profile);
  const allocations = engine.snapshot().allocations;
  const specifications = new Map<FoundationExecutionHandle, FoundationExecutionSpecificationV1>();
  const supplied = new Set<FoundationExecutionHandle>();
  for (const allocation of allocations) {
    const handle = privateFoundationExecutionHandle(allocation.handle);
    specifications.set(handle, allocation.specification);
    if (allocation.dispatched) supplied.add(handle);
  }
  const observeBinding = async (handle: FoundationExecutionHandle) => {
    // The real Docker driver consults the registry before retaining an
    // allocation observation. Exercise that connection with supplied Cell facts.
    await bindingRegistry.observationSequence.next(handle.slice("execution-handle-v1:".length));
  };
  const responses = new Map<string, Readonly<{ exitCode: number; stdout?: string }>>();
  let dispatches = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile,
    async allocate(specification: FoundationExecutionSpecificationV1, allocationKey: Parameters<FoundationExecutionBackend["allocate"]>[1]) {
      assert.equal(specification.owner.kind, "check");
      const handle = await delegate.allocate(specification, allocationKey);
      specifications.set(handle, specification);
      await observeBinding(handle);
      input.afterAllocate?.(specification);
      return handle;
    },
    async dispatch(handle: FoundationExecutionHandle) {
      dispatches += 1;
      assert.equal(supplied.has(handle), false, "A connected Check must not redispatch its retained execution");
      const specification = specifications.get(handle);
      assert(specification !== undefined && specification.owner.kind === "check");
      const response = responses.get(`${specification.owner.activityId}\0${specification.owner.selectionId}`);
      assert(response !== undefined);
      await engine.provideOutput(specification, checkExecutionOutput(specification, {
        ...response, observedAt: input.now(),
      }));
      supplied.add(handle);
      return await delegate.dispatch(handle);
    },
    async observe(handle: FoundationExecutionHandle) {
      await observeBinding(handle);
      return await delegate.observe(handle);
    },
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const reclamation = await openFoundationExecutionReclamationLedgerV1({
    machineHome: input.machineHome,
    installationId: input.installationId ?? "installation-agent-operation-v7",
    create: true,
    clock,
  });
  const owner = createFoundationCheckCellOperatorV1({
    backend, profile, clock, reclamation,
    engineIdentityDigest: sha256Bytes("connected-check-engine"),
    bindingRegistry,
    inputTransport: new FoundationCheckCellInputTransportRegistryV1(),
    image,
    outputStore: createFoundationExecutionOutputStoreV1({ machineHome: input.machineHome }),
    pollMilliseconds: 0,
  });
  return Object.freeze({
    resources: Object.freeze({ profile, image }),
    operator: Object.freeze({
      clock,
      async operate(request: FoundationCheckCellOperationRequestV1) {
        responses.set(`${request.activityId}\0${request.selectionId}`, input.response?.(request) ?? { exitCode: 0 });
        return await owner.operate(request);
      },
    }),
    dispatchCount: () => dispatches,
    specifications: () => Object.freeze([...specifications.values()]),
    engineSnapshot: () => engine.snapshot(),
    close: () => reclamation.close(),
  });
}
