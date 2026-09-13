import { canonicalJson, type Sha256 } from "../validation/canonical.js";
import type { FoundationExecutionBackend } from "./backend.js";
import type {
  FoundationExecutionImageReferenceV1,
  FoundationExecutionSpecificationV1,
} from "./contracts.js";
import { foundationDockerReclamationBindingMatchesEngineV1 } from "./docker-backend.js";
import type {
  FoundationExecutionReclamationHandoffV1,
  FoundationExecutionReclamationLedgerV1,
} from "./reclamation-ledger-v1.js";

/**
 * Installation-private maintenance around one invocation. Each hook attempts
 * at most one eligible obligation; the ledger retains retries and exact CAS.
 * The operation owns its result, independently of physical deletion progress.
 */
export function withFoundationInstalledReclamationMaintenanceV1<Request, Result>(input: Readonly<{
  ledger: FoundationExecutionReclamationLedgerV1;
  backend: Pick<FoundationExecutionBackend, "profile" | "reclaim">;
  image: FoundationExecutionImageReferenceV1 & Readonly<{ runnerContractDigest: Sha256 }>;
  engineIdentityDigest(): Promise<Sha256>;
  agent: (Pick<FoundationExecutionSpecificationV1, "credentialPolicy" | "networkPolicy"> & Readonly<{
    providerDescriptorDigest: Sha256;
    adapterImplementationDigest: Sha256;
  }>) | null;
  operate(request: Request): Promise<Result>;
}>): Readonly<{
  operate(request: Request): Promise<Result>;
  reclaimNext(): Promise<boolean>;
}> {
  const profile = canonicalJson({
    profileId: input.backend.profile.profileId,
    profileDigest: input.backend.profile.digest,
    implementationDigest: input.backend.profile.implementation.implementationDigest,
  });
  const image = canonicalJson({ imageId: input.image.imageId, imageDigest: input.image.imageDigest });
  const agent = input.agent === null ? null : canonicalJson(input.agent);
  function eligible(handoff: FoundationExecutionReclamationHandoffV1, engine: Sha256): boolean {
    const specification = handoff.specification;
    if (canonicalJson(specification.backendProfile) !== profile ||
        canonicalJson(specification.image) !== image ||
        specification.runner.contractDigest !== input.image.runnerContractDigest ||
        !foundationDockerReclamationBindingMatchesEngineV1(
          handoff.reclamationBinding.backendBinding, engine,
        )) return false;
    if (specification.owner.kind === "check") {
      return specification.credentialPolicy.mode === "none" &&
        specification.networkPolicy.providerControlPlane === "none";
    }
    // Only an Agent owner carries the exact credential-settlement resolver.
    return agent !== null && specification.operation.kind === "agent-attempt" && canonicalJson({
      credentialPolicy: specification.credentialPolicy,
      networkPolicy: specification.networkPolicy,
      providerDescriptorDigest: specification.operation.providerDescriptorDigest,
      adapterImplementationDigest: specification.operation.adapterImplementationDigest,
    }) === agent;
  }
  async function reclaimNext(): Promise<boolean> {
    const engine = await input.engineIdentityDigest();
    return (await input.ledger.runNext({
      eligible: handoff => eligible(handoff, engine),
      reclaim: async (handoff) => await input.backend.reclaim(
        handoff.specification, handoff.reclamationBinding, handoff.obligation,
      ),
    })) !== null;
  }
  async function maintain(): Promise<void> {
    try {
      await reclaimNext();
    } catch {
      // A failed physical attempt retains its lease for expiry/retry. Neither
      // that failure nor a private ledger refusal changes operation truth.
    }
  }
  return Object.freeze({
    reclaimNext,
    async operate(request: Request): Promise<Result> {
      await maintain();
      const result = await input.operate(request);
      // Any completed allocation has retained its Output disposition and
      // Retirement handoff. A result without allocation creates no obligation;
      // this hook may instead maintain older work from the same installed owner.
      await maintain();
      return result;
    },
  });
}
