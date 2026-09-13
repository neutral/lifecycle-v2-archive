import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import {
  compileExecutionReclamationBinding,
  compileExecutionReclamationObligation,
  compileExecutionReclamationObservation,
  privateFoundationExecutionHandle,
} from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
} from "../../src/foundation/execution/contracts.js";
import { foundationDockerExecutionBackendProfileV1 } from "../../src/foundation/execution/docker-profile-v1.js";
import { withFoundationInstalledReclamationMaintenanceV1 } from "../../src/foundation/execution/installed-reclamation-maintenance-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
  type FoundationExecutionReclamationHandoffInputV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { selfDigest, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { digest, executionContractFixture } from "../support/execution-contract-fixture.js";
import { createConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";

const profile = foundationDockerExecutionBackendProfileV1();
const image = Object.freeze({ imageId: "lifecycle.execution-image.codex-standard.v1",
  imageDigest: digest("maintenance-image"), runnerContractDigest: digest("runner-contract") });
const engineIdentityDigest = digest("maintenance-engine");
const agent = Object.freeze({
  providerDescriptorDigest: digest("provider"),
  adapterImplementationDigest: digest("adapter"),
  credentialPolicy: Object.freeze({ mode: "fixed-runner" as const,
    bindings: Object.freeze([{ id: "provider-control", policyDigest: digest("maintenance-credential-policy") }]),
    agentAccess: false as const, outputDisclosure: false as const }),
  networkPolicy: Object.freeze({ agentProductNetwork: "none" as const,
    agentPolicyDigest: digest("agent-network"), providerControlPlane: "fixed-service-channel" as const,
    providerPolicyDigest: digest("maintenance-provider-policy"), separationRequired: true as const }),
});

function handoff(salt: string, options: Readonly<{
  check?: boolean;
  profile?: FoundationExecutionBackendProfileV1;
  engine?: Sha256;
  bindingSchema?: string;
  malformedBinding?: boolean;
  mutate?: (subject: ControlJsonObject) => ControlJsonObject;
}> = {}): FoundationExecutionReclamationHandoffInputV1 {
  const base = executionContractFixture(salt);
  const { digest: _digest, ...baseSubject } = base.specification;
  const selectedProfile = options.profile ?? profile;
  const subject = {
    ...baseSubject,
    image: { imageId: image.imageId, imageDigest: image.imageDigest },
    backendProfile: { profileId: selectedProfile.profileId, profileDigest: selectedProfile.digest,
      implementationDigest: selectedProfile.implementation.implementationDigest },
    ...(options.check ? {
      owner: { kind: "check", activityId: `activity.${salt}`, selectionId: `check.${salt}`,
        phase: "final", ownerSubjectDigest: digest(`proof-${salt}`) },
      operation: { kind: "check", phase: "final", selectionId: `check.${salt}`,
        definitionDigest: digest("definition"), bindingDigest: digest("binding"),
        runnerImplementationDigest: digest("check-runner"), parserImplementationDigest: digest("check-parser") },
      runner: { ...baseSubject.runner, operationId: "check.execute" },
      outputContract: (() => {
        const { digest: _outputDigest, ...output } = baseSubject.outputContract;
        const next = { ...output, declaredOutputRoots: output.declaredOutputRoots.map(root => ({
          ...root, purpose: "check-proof",
        })) };
        return { ...next, digest: selfDigest(next) };
      })(),
    } : { credentialPolicy: agent.credentialPolicy, networkPolicy: agent.networkPolicy }),
  } as ControlJsonObject;
  const selected = options.mutate?.(subject) ?? subject;
  const specification = parseFoundationExecutionSpecification({
    value: { ...selected, digest: selfDigest(selected) },
    backendProfile: selectedProfile,
    image: selected.image as typeof base.image,
    inputSet: base.inputSet,
  });
  const handle = privateFoundationExecutionHandle(`execution-handle-v1:${digest(salt).slice(7)}`);
  const retirementCheckpointDigest = digest(`retirement-checkpoint-${salt}`);
  const reclamationBinding = compileExecutionReclamationBinding({
    specification, handle, retirementCheckpointDigest, dispatchAuthorityConsumed: true,
    backendBinding: { schema: options.bindingSchema ?? "lifecycle.docker-reclamation-binding.private.v1",
      engineIdentityDigest: options.engine ?? engineIdentityDigest,
      allocationKeyDigest: options.malformedBinding ? "not-a-digest" : digest(`allocation-${salt}`) },
  });
  return {
    owner: { storeId: "store.maintenance", processId: "delivery.maintenance",
      activityId: specification.owner.activityId, kind: specification.owner.kind,
      subjectDigest: specification.owner.kind === "agent-attempt"
        ? specification.owner.attempt.digest : specification.owner.ownerSubjectDigest },
    specification, handle, reclamationBinding,
    obligation: compileExecutionReclamationObligation({ specification, handle, retirementCheckpointDigest, reclamationBinding }),
    retirementDigest: digest(`retirement-${salt}`), dispatchAuthorityConsumed: true,
  };
}

async function fixture(t: TestContext) {
  const machineHome = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-maintenance-test-")));
  let milliseconds = Date.parse("2026-09-07T12:00:00.000Z");
  const now = () => new Date(milliseconds).toISOString();
  const options = { machineHome, installationId: `installation.lifecycle.${"9".repeat(64)}`,
    create: true, clock: { now } };
  const ledger = await openFoundationExecutionReclamationLedgerV1(options);
  t.after(async () => { ledger.close(); await rm(machineHome, { recursive: true, force: true }); });
  return { ledger, options, now, advance: (amount = 1) => { milliseconds += amount; } };
}

test("installed maintenance reclaims an expired compatible obligation and a new handoff without replacing the operation result", async t => {
  const f = await fixture(t);
  const incompatible = handoff("old-image", { mutate: subject => ({ ...subject,
    image: { imageId: image.imageId, imageDigest: digest("older-image") } }) });
  f.ledger.accept(incompatible);
  const original = f.ledger.list()[0];
  f.advance();
  const prior = handoff("expired");
  f.ledger.accept(prior);
  const expired = f.ledger.claimNext(1_000, retained => retained.obligation.digest === prior.obligation.digest);
  assert(expired);
  f.advance(1_001);
  const current = handoff("current");
  const effects: string[] = [];
  const result = Object.freeze({ terminal: "completed", retirementDigest: current.retirementDigest });
  const owner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => engineIdentityDigest, agent,
    backend: { profile, async reclaim(specification, binding, obligation) {
      const expected = specification.digest === prior.specification.digest ? prior : current;
      assert.deepEqual(binding, expected.reclamationBinding);
      assert.deepEqual(obligation, expected.obligation);
      effects.push(specification.owner.activityId);
      return compileExecutionReclamationObservation({ obligation, observedAt: f.now(),
        disposition: "reclaimed", factsDigest: digest(`removed-${specification.digest}`) });
    } },
    async operate(request: string) {
      assert.equal(request, "execute");
      assert.deepEqual(effects, [prior.owner.activityId]);
      f.ledger.accept(current);
      return result;
    },
  });
  assert.equal(await owner.operate("execute"), result);
  assert.deepEqual(effects, [prior.owner.activityId, current.owner.activityId]);
  assert.deepEqual(f.ledger.list().find(row => row.obligationDigest === incompatible.obligation.digest), original);
  assert.equal(f.ledger.list().find(row => row.obligationDigest === prior.obligation.digest)?.standing.attemptCount, 2);
  assert.equal(f.ledger.list().find(row => row.obligationDigest === current.obligation.digest)?.standing.state, "reclaimed");
  const reopened = await openFoundationExecutionReclamationLedgerV1(f.options);
  try {
    assert.equal(reopened.list().filter(row => row.standing.state === "reclaimed").length, 2);
    assert.equal(await owner.reclaimNext(), false);
    assert.throws(() => reopened.completeClaim({ claim: expired,
      observation: compileExecutionReclamationObservation({ obligation: prior.obligation, observedAt: f.now(),
        disposition: "remaining", factsDigest: digest("stale-completion") }) }), /claim/u);
  } finally { reopened.close(); }
});

test("the installed Agent composing factory reclaims the real Cell handoff before preparation finalizes", async () => {
  const f = await createConnectedDeliveryFixture({ id: "installed-reclamation", agentBackend: "docker-observed" });
  try {
    assert.equal((await f.prepare()).outcome, "completed");
    const ledger = await openFoundationExecutionReclamationLedgerV1({
      machineHome: f.machineHome, installationId: f.configuration.installationId!, create: false,
      clock: { now: f.now },
    });
    try {
      const agentRows = ledger.list().filter(row => row.owner.kind === "agent-attempt");
      assert.equal(agentRows.length, 1);
      assert.equal(agentRows[0]?.standing.state, "reclaimed");
      assert.equal(agentRows[0]?.standing.attemptCount, 1);
      assert.equal(f.invocations.length, 1);
      assert.notEqual(f.store.state().subjects.proposedBoundary, null);
    } finally { ledger.close(); }
  } finally { await f.dispose(); }
});

test("installed maintenance skips exact resource and provider mismatches without claiming them", async t => {
  const f = await fixture(t);
  const { digest: _digest, ...profileSubject } = profile;
  const changedProfile = { ...profileSubject, implementation: { ...profile.implementation,
    implementationDigest: digest("another-backend-implementation") } };
  const otherProfile = parseFoundationExecutionBackendProfile({ ...changedProfile, digest: selfDigest(changedProfile) });
  const variants: readonly Parameters<typeof handoff>[1][] = [
    { mutate: subject => ({ ...subject, image: { imageId: "another-image", imageDigest: image.imageDigest } }) },
    { mutate: subject => ({ ...subject, image: { imageId: image.imageId, imageDigest: digest("another-image") } }) },
    { profile: otherProfile },
    { engine: digest("another-engine") },
    { bindingSchema: "lifecycle.docker-reclamation-binding.private.v2" },
    { mutate: subject => ({ ...subject, runner: { ...subject.runner as ControlJsonObject,
      contractDigest: digest("another-runner") } }) },
    { mutate: subject => ({ ...subject, operation: { ...subject.operation as ControlJsonObject,
      providerDescriptorDigest: digest("another-provider") } }) },
    { mutate: subject => ({ ...subject, operation: { ...subject.operation as ControlJsonObject,
      adapterImplementationDigest: digest("another-adapter") } }) },
    { mutate: subject => ({ ...subject, credentialPolicy: { ...agent.credentialPolicy,
      bindings: [{ id: "provider-control", policyDigest: digest("another-credential-policy") }] } }) },
    { mutate: subject => ({ ...subject, networkPolicy: { ...agent.networkPolicy,
      providerPolicyDigest: digest("another-provider-policy") } }) },
  ];
  for (let index = 0; index < variants.length; index += 1) {
    f.ledger.accept(handoff(`incompatible-${index}`, variants[index]));
    f.advance();
  }
  const before = f.ledger.list();
  const calls: string[] = [];
  const matching = handoff("matching");
  f.ledger.accept(matching);
  const owner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => engineIdentityDigest, agent,
    backend: { profile, async reclaim(specification, _binding, obligation) {
      calls.push(specification.digest);
      return compileExecutionReclamationObservation({ obligation, observedAt: f.now(),
        disposition: "reclaimed", factsDigest: digest("matching-removed") });
    } },
    async operate() { return "unused"; },
  });
  assert.equal(await owner.reclaimNext(), true);
  assert.deepEqual(calls, [matching.specification.digest]);
  assert.deepEqual(f.ledger.list().filter(row => row.obligationDigest !== matching.obligation.digest), before);
  assert.equal(await owner.reclaimNext(), false);
  assert.equal(calls.length, 1);
});

test("Check maintenance leaves Agent custody untouched while an Agent owner can reclaim both kinds", async t => {
  const f = await fixture(t);
  const agentHandoff = handoff("agent-first");
  f.ledger.accept(agentHandoff);
  const original = f.ledger.list()[0];
  f.advance();
  const checkHandoff = handoff("check-second", { check: true });
  f.ledger.accept(checkHandoff);
  const calls: string[] = [];
  const backend = { profile, async reclaim(specification: typeof agentHandoff.specification,
    _binding: typeof agentHandoff.reclamationBinding, obligation: typeof agentHandoff.obligation) {
    calls.push(specification.owner.kind);
    return compileExecutionReclamationObservation({ obligation, observedAt: f.now(),
      disposition: "reclaimed", factsDigest: digest(`removed-${specification.digest}`) });
  } };
  const checkOwner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => engineIdentityDigest, agent: null, backend,
    async operate() { return "check-result"; },
  });
  assert.equal(await checkOwner.operate(undefined), "check-result");
  assert.deepEqual(calls, ["check"]);
  assert.deepEqual(f.ledger.list().find(row => row.obligationDigest === agentHandoff.obligation.digest), original);
  f.advance();
  f.ledger.accept(handoff("another-check", { check: true }));
  const agentOwner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => engineIdentityDigest, agent, backend,
    async operate() { return "agent-result"; },
  });
  assert.equal(await agentOwner.operate(undefined), "agent-result");
  assert.deepEqual(calls, ["check", "agent-attempt", "check"]);
});

test("maintenance failure retains its claim without replacing operation results or errors", async t => {
  const f = await fixture(t);
  const retired = handoff("failure");
  f.ledger.accept(retired);
  const result = Object.freeze({ terminal: "completed", retirementDigest: retired.retirementDigest });
  const originalError = new Error("operation failure");
  let calls = 0;
  const owner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => engineIdentityDigest, agent,
    backend: { profile, async reclaim() { calls += 1; throw new Error("physical cleanup unavailable"); } },
    async operate(fail: boolean) { if (fail) throw originalError; return result; },
  });
  assert.equal(await owner.operate(false), result);
  assert.equal(calls, 1);
  assert.equal(f.ledger.list()[0]?.standing.state, "claimed");
  assert.equal(f.ledger.list()[0]?.standing.lastObservationDigest, null);
  await assert.rejects(owner.operate(true), error => error === originalError);
  assert.equal(calls, 1);
  f.advance(60_001);
  assert.equal(await owner.operate(false), result);
  assert.equal(calls, 2);
  assert.equal(f.ledger.list()[0]?.standing.attemptCount, 2);
});

test("maintenance observes the current Engine before claiming and refuses malformed current bindings", async t => {
  const f = await fixture(t);
  const retired = handoff("engine-change");
  f.ledger.accept(retired);
  const original = f.ledger.list();
  let selectedEngine = digest("replacement-engine");
  let calls = 0;
  const owner = withFoundationInstalledReclamationMaintenanceV1({
    ledger: f.ledger, image, engineIdentityDigest: async () => selectedEngine, agent,
    backend: { profile, async reclaim(_specification, _binding, obligation) {
      calls += 1;
      return compileExecutionReclamationObservation({ obligation, observedAt: f.now(),
        disposition: "reclaimed", factsDigest: digest("engine-change-reclaimed") });
    } },
    async operate() { return "unused"; },
  });
  assert.equal(await owner.reclaimNext(), false);
  assert.equal(calls, 0);
  assert.deepEqual(f.ledger.list(), original);
  selectedEngine = engineIdentityDigest;
  assert.equal(await owner.reclaimNext(), true);
  f.advance();
  f.ledger.accept(handoff("malformed-binding", { malformedBinding: true }));
  const beforeRefusal = f.ledger.list();
  await assert.rejects(owner.reclaimNext(), /Docker Reclamation binding is invalid or substituted/u);
  assert.deepEqual(f.ledger.list(), beforeRefusal);
  assert.equal(calls, 1);
});
