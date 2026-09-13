import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { FoundationProcessRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import { openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import { parseFoundationExecutionBackendProfile } from "../../src/foundation/execution/contracts.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import {
  operateFoundationCandidateAgentRuntimeV7,
  recoverFoundationCandidateAgentRuntimeV7,
} from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import {
  acceptDeliveryV7,
  noShipDeliveryV7,
  recoverTerminalDeliveryV7,
  type FoundationTerminalV7Options,
  type FoundationTerminalV7Stage,
} from "../../src/foundation/transaction/terminal-v7.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { installedHarness } from "./agent-cell-runtime-fixture.js";
import {
  CONNECTED_BACKEND_LIMITS,
  CONNECTED_DIRECTOR_ID,
  CONNECTED_RUNTIME_ID,
  connectedAuthorityCredential,
  connectedBuilderMarkdown,
  connectedCandidateOutput,
  connectedSemanticEntry,
  writeConnectedFile,
} from "./connected-delivery-fixture.js";
import { connectedWorkerCheckpoint, connectedWorkerResult } from "./connected-process.js";
import { openConnectedDiskBackend, type ConnectedBackendMethod } from "./disk-execution-backend.js";
import { executionContractFixture } from "./execution-contract-fixture.js";

export type ConnectedRecoveryDescriptor = Readonly<{
  workspace: string;
  target: string;
  machineHome: string;
  authorityHome: string;
  targetId: string;
  deliveryId: string;
  configuration: FoundationProcessRuntimeConfigurationV7;
  backendPath: string;
  activityId: string;
}>;

export type ConnectedRecoveryInvocation = Readonly<{
  operation: "continue" | "recover-agent" | "accept" | "no-ship" | "recover-terminal";
  backendCheckpoint?: ConnectedBackendMethod;
  terminalCheckpoint?: FoundationTerminalV7Stage;
  terminalCheckpoints?: readonly FoundationTerminalV7Stage[];
  changedDefaults?: boolean;
  custody?: "unavailable" | "substituted";
}>;

function changedConfiguration(configuration: FoundationProcessRuntimeConfigurationV7): FoundationProcessRuntimeConfigurationV7 {
  assert(configuration.execution !== undefined);
  const imageDigest = sha256Bytes("connected-restart-new-default-image");
  return {
    ...configuration,
    model: "deterministic-test-replacement",
    reasoning: "medium",
    execution: {
      image: {
        ...configuration.execution.image,
        imageId: "image.connected-future-default",
        imageDigest,
        immutableReference: `registry.example/connected@${imageDigest}`,
        configurationDigest: sha256Bytes("connected-restart-new-default-configuration"),
      },
    },
  };
}

async function run(): Promise<unknown> {
  const descriptor: ConnectedRecoveryDescriptor = JSON.parse(await readFile(process.argv[2]!, "utf8"));
  const invocation: ConnectedRecoveryInvocation = JSON.parse(process.argv[3]!);
  const { store } = await openDeliveryControlRecordStore({
    machineHome: descriptor.machineHome,
    targetId: descriptor.targetId,
    deliveryId: descriptor.deliveryId,
  });
  const events = store.listEvents(0, 10_000);
  let clock = Math.max(...events.map(({ occurredAt }) => Date.parse(occurredAt))) + 1000;
  const now = () => new Date(clock += 1000).toISOString();
  try {
    if (invocation.operation === "continue" || invocation.operation === "recover-agent") {
      const contract = executionContractFixture("agent-operation-v7");
      const profileSubject = { ...contract.profile, limits: CONNECTED_BACKEND_LIMITS };
      const profile = parseFoundationExecutionBackendProfile({
        ...profileSubject,
        digest: selfDigest(profileSubject),
      });
      const disk = await openConnectedDiskBackend({
        path: descriptor.backendPath,
        profile,
        afterCall: async (call) => {
          if (call.method === invocation.backendCheckpoint) {
            await connectedWorkerCheckpoint({ boundary: `backend.${call.method}`, call });
          }
        },
      });
      const harness = installedHarness({
        machineHome: descriptor.machineHome,
        now,
        backendLimits: CONNECTED_BACKEND_LIMITS,
        ...disk,
        produceOutput: async (input) => ({ entries: [
          ...await connectedCandidateOutput({
            machineHome: descriptor.machineHome,
            workspace: descriptor.workspace,
            input,
            edit: async (repository) => {
              await writeConnectedFile(repository, "src/demo.ts", "export const value = 'recovered';\n");
            },
          }),
          connectedSemanticEntry(connectedBuilderMarkdown()),
        ] }),
      });
      const agentOperation = invocation.operation === "continue" ? harness.options : {
        ...harness.options,
        compileInstalled: () => { throw new Error("Cold recovery attempted to choose current installed defaults"); },
        openInstalled: async (selected: Parameters<NonNullable<typeof harness.options.openInstalled>>[0]) => {
          assert.deepEqual(selected.image, descriptor.configuration.execution!.image);
          assert.deepEqual(selected.investment, {
            model: descriptor.configuration.model,
            reasoning: descriptor.configuration.reasoning,
          });
          assert.equal(selected.installed.profile.digest, profile.digest);
          if (invocation.custody === "unavailable") {
            throw new Error("Exact retained execution custody is temporarily unavailable");
          }
          return harness.options.openInstalled!({
            ...selected,
            ...(invocation.custody === "substituted" ? {
              installed: {
                ...selected.installed,
                image: { ...selected.installed.image, imageDigest: sha256Bytes("substituted-custody-image") },
              },
            } : {}),
          });
        },
      };
      const configuration = invocation.changedDefaults === true
        ? changedConfiguration(descriptor.configuration) : descriptor.configuration;
      const input = {
        target: descriptor.target,
        store,
        configuration,
        activityId: descriptor.activityId,
        operation: "delivery.continue" as const,
      };
      const result = invocation.operation === "continue"
        ? await operateFoundationCandidateAgentRuntimeV7({
          ...input,
          runtimeId: CONNECTED_RUNTIME_ID,
          agentId: "agent:connected-restart-builder",
          opening: {
            directorId: CONNECTED_DIRECTOR_ID,
            semanticMarkdown: "# Continue\n\nComplete the admitted source change across interruption.\n",
            submittedAt: now(),
            startedAt: now(),
            attemptCreatedAt: now(),
          },
        }, { agentOperation })
        : await recoverFoundationCandidateAgentRuntimeV7(input, { agentOperation });
      return { pid: process.pid, result, subjects: store.state().subjects };
    }

    const terminalOptions: FoundationTerminalV7Options = {
      now,
      onStage: async (stage) => {
        if (stage === invocation.terminalCheckpoint || invocation.terminalCheckpoints?.includes(stage)) {
          await connectedWorkerCheckpoint({ boundary: stage });
        }
      },
      observeReclamationHandoff: async (input) => {
        const ledger = await openFoundationExecutionReclamationLedgerV1({
          machineHome: descriptor.machineHome,
          installationId: descriptor.configuration.installationId!,
          create: false,
          clock: { now },
        });
        try { return ledger.verifyTerminalSubjects(input); }
        finally { ledger.close(); }
      },
    };
    const recovery = {
      target: descriptor.target,
      machineHome: descriptor.machineHome,
      store,
      runtimeId: CONNECTED_RUNTIME_ID,
    };
    const result = invocation.operation === "recover-terminal"
      ? await recoverTerminalDeliveryV7(recovery, terminalOptions)
      : await (invocation.operation === "accept" ? acceptDeliveryV7 : noShipDeliveryV7)({
        ...recovery,
        authorityHome: descriptor.authorityHome,
        authorityCredential: connectedAuthorityCredential("director-decision"),
        ...(invocation.operation === "no-ship" ? {
          semanticMarkdown: "# No ship\n\nThe Director intentionally ends this bounded restart course without publication.\n",
        } : {}),
      }, terminalOptions);
    return { pid: process.pid, result };
  } finally {
    store.close();
  }
}

if (process.argv[2] !== undefined && process.send !== undefined) {
  await connectedWorkerResult(run);
}
