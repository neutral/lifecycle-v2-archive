import type {
  FoundationCheckCellRuntimeV1,
  FoundationCheckCellOperatorV1,
} from "../check/execution-cell-v1.js";
import {
  FoundationCheckCellInputTransportRegistryV1,
  operateFoundationCheckCellV1,
} from "../check/execution-cell-v1.js";
import type {
  FoundationInstalledRuntimeConfigurationV7,
  FoundationProcessRuntimeConfigurationV7,
} from "../installed-configuration-v7.js";
import { FoundationError } from "../error.js";
import { createFoundationDockerExecutionBackend } from "./docker-backend.js";
import { FoundationDockerExecutionBindingRegistryV1 } from "./docker-binding-registry-v1.js";
import { createFoundationDockerCliEngineDriverV1 } from "./docker-cli-engine-driver-v1.js";
import { foundationDockerExecutionBackendProfileV1 } from "./docker-profile-v1.js";
import { createFoundationExecutionOutputStoreV1 } from "./output-store-v1.js";
import { withFoundationInstalledReclamationMaintenanceV1 } from "./installed-reclamation-maintenance-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
  type FoundationExecutionReclamationPreIntentRefusalV1,
  type FoundationExecutionReclamationTerminalSubjectV1,
  type FoundationExecutionReclamationTerminalVerificationV1,
} from "./reclamation-ledger-v1.js";

export type FoundationOpenedInstalledCheckRuntimeV1 = Readonly<{
  operator: FoundationCheckCellOperatorV1;
  observeTerminalReclamation(input: Readonly<{
    machineHome: string;
    storeId: string;
    processId: string;
    subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
    preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
  }>): FoundationExecutionReclamationTerminalVerificationV1;
  reclaimNext(): Promise<boolean>;
  close(): void;
}>;

export type FoundationOpenedInstalledReclamationObserverV1 = Readonly<{
  observeTerminalReclamation(
    input: Readonly<{
      machineHome: string;
      storeId: string;
      processId: string;
      subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
      preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
    }>,
  ): FoundationExecutionReclamationTerminalVerificationV1;
  close(): void;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.installed-check-runtime-v1.${code}`, message);
}

/** Resolve the same public resource values for reservation and actual Check execution. */
export function selectFoundationInstalledCheckResourcesV1(
  configuration: Pick<FoundationProcessRuntimeConfigurationV7, "execution">,
): Pick<FoundationCheckCellRuntimeV1, "profile" | "image"> {
  const image = configuration.execution?.image;
  if (image === undefined) fail("unconfigured", "Final Check resources require one exact installed Execution Image selection");
  return Object.freeze({ profile: foundationDockerExecutionBackendProfileV1(),
    image: Object.freeze({ imageId: image.imageId, imageDigest: image.imageDigest,
      runnerContractDigest: image.runnerContractDigest, runnerImplementationDigest: image.runnerImplementationDigest,
      toolInventoryDigest: image.toolInventoryDigest }) });
}

/** Only the exact Check operation and observation clock leave execution custody. */
export function createFoundationCheckCellOperatorV1(
  runtime: FoundationCheckCellRuntimeV1,
): FoundationCheckCellOperatorV1 {
  return Object.freeze({
    operate: async (request) => await operateFoundationCheckCellV1({ ...request, runtime }),
    clock: runtime.clock,
  });
}

export async function openFoundationInstalledReclamationObserverV1(input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  now: () => string;
}>): Promise<FoundationOpenedInstalledReclamationObserverV1> {
  const ledger = await openFoundationExecutionReclamationLedgerV1({
    machineHome: input.configuration.machineHome,
    installationId: input.configuration.installationId,
    create: true,
    clock: Object.freeze({ now: input.now }),
  });
  return Object.freeze({
    observeTerminalReclamation(observationInput) {
      if (observationInput.machineHome !== input.configuration.machineHome) {
        fail("machine-substitution", "Terminal Reclamation observer selected another machine custody root");
      }
      return ledger.verifyTerminalSubjects({
        storeId: observationInput.storeId,
        processId: observationInput.processId,
        subjects: observationInput.subjects,
        preIntentRefusals: observationInput.preIntentRefusals,
      });
    },
    close(): void { ledger.close(); },
  });
}

/**
 * Open the sole installed Check execution composition. This owns mechanics
 * only: Delivery and Check state remain with their existing Process owners.
 */
export async function openFoundationInstalledCheckRuntimeV1(input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  now: () => string;
}>): Promise<FoundationOpenedInstalledCheckRuntimeV1> {
  const installed = input.configuration.execution;
  if (installed === undefined) {
    fail(
      "unconfigured",
      "Final Check execution requires one exact installed Docker Engine and Execution Image selection",
    );
  }
  const resources = selectFoundationInstalledCheckResourcesV1(input.configuration);
  const profile = resources.profile;
  const inputTransport = new FoundationCheckCellInputTransportRegistryV1();
  const bindingRegistry = new FoundationDockerExecutionBindingRegistryV1();
  const driver = await createFoundationDockerCliEngineDriverV1({
    profile,
    dockerExecutable: installed.dockerExecutable,
    dockerExecutableDigest: installed.dockerExecutableDigest,
    engineEndpoint: installed.engineEndpoint,
    dockerConfigDirectory: installed.dockerConfigDirectory,
    images: Object.freeze([installed.image]),
    inputTransport,
    observationSequence: bindingRegistry.observationSequence,
    now: input.now,
  });
  const engine = await driver.describe();
  const backend = await createFoundationDockerExecutionBackend({
    profile,
    driver,
    resolveBinding: bindingRegistry.resolve,
    now: input.now,
  });
  const ledger = await openFoundationExecutionReclamationLedgerV1({
    machineHome: input.configuration.machineHome,
    installationId: input.configuration.installationId,
    create: true,
    clock: Object.freeze({ now: input.now }),
  });
  const runtime: FoundationCheckCellRuntimeV1 = Object.freeze({
    backend,
    profile,
    engineIdentityDigest: engine.engineIdentityDigest,
    bindingRegistry,
    image: resources.image,
    outputStore: createFoundationExecutionOutputStoreV1({
      machineHome: input.configuration.machineHome,
    }),
    reclamation: ledger,
    inputTransport,
    clock: Object.freeze({ now: input.now }),
    pollMilliseconds: 100,
  });
  const operator = createFoundationCheckCellOperatorV1(runtime);
  const maintained = withFoundationInstalledReclamationMaintenanceV1({
    ledger, backend, image: resources.image,
    engineIdentityDigest: async () => (await driver.describe()).engineIdentityDigest,
    agent: null,
    operate: operator.operate,
  });
  return Object.freeze({
    operator: Object.freeze({ operate: maintained.operate, clock: operator.clock }),
    observeTerminalReclamation(observationInput) {
      if (observationInput.machineHome !== input.configuration.machineHome) {
        fail("machine-substitution", "Terminal Reclamation observer selected another machine custody root");
      }
      return ledger.verifyTerminalSubjects({
        storeId: observationInput.storeId,
        processId: observationInput.processId,
        subjects: observationInput.subjects,
        preIntentRefusals: observationInput.preIntentRefusals,
      });
    },
    reclaimNext: maintained.reclaimNext,
    close(): void { ledger.close(); },
  });
}
