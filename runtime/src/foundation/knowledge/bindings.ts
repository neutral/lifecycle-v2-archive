import { pathWithin } from "../repository/product-state.js";
import type { FoundationCheckBinding, FoundationGitTreeEntry, FoundationRepositoryContract } from "../repository/types.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { DiagnosticCollector } from "../validation/result.js";
import type { FoundationCheckSpec, FoundationKnowledgeRecord } from "./types.js";

const BINDING_STAGE = "bindings";

type ResolvedBinding = Readonly<{ checkId: string; binding: FoundationCheckBinding }>;

function compatibilityFacts(options: {
  check: FoundationKnowledgeRecord;
  binding: FoundationCheckBinding;
  contract: FoundationRepositoryContract;
  treeEntries: readonly FoundationGitTreeEntry[];
}): readonly string[] {
  const spec = options.check.frontMatter.spec as FoundationCheckSpec;
  const failures: string[] = [];
  if (!options.binding.checkIds.includes(options.check.frontMatter.id)) failures.push("check-identity");
  const expectedSubjects = spec.subjects.map(({ kind, selector }) => `${kind}\0${selector}`).sort(compareCodePoints);
  const actualSubjects = options.binding.subjectSelectors.map(({ kind, selector }) => `${kind}\0${selector}`).sort(compareCodePoints);
  if (expectedSubjects.length !== actualSubjects.length || expectedSubjects.some((value, index) => value !== actualSubjects[index])) {
    failures.push("subject-selectors");
  }
  if (!spec.evidenceKinds.includes("command") && !spec.evidenceKinds.includes("mixed")) failures.push("evidence-kind");
  if (spec.evidenceKinds.some((kind) => kind !== "command" && kind !== "mixed")) failures.push("evidence-kind-unsupported");
  if (options.binding.resultParser.stateModel !== "check-disposition-v2" ||
      options.binding.resultParser.states.join("\0") !==
        "pass\0fail\0indeterminate\0not-run\0unsupported\0operational-error") {
    failures.push("result-states");
  }
  if (options.binding.mutation !== "forbidden") failures.push("mutation-policy");
  if (options.binding.cwd !== "." && !options.treeEntries.some((entry) => pathWithin(entry.path, options.binding.cwd))) failures.push("working-directory");

  if (options.binding.capabilityProfileId !== null) {
    const capability = options.contract.capabilityProfiles[options.binding.capabilityProfileId];
    if (capability === undefined) {
      failures.push("capability-profile");
    } else {
      if (capability.candidateWrites || capability.externalEffects.length > 0) failures.push("proof-capability-effects");
      if (capability.subprocesses === "none") failures.push("command-capability");
      if (options.binding.network === "loopback" && capability.network.mode !== "loopback") failures.push("network-capability");
      if (capability.credentials !== "none") failures.push("credential-capability");
    }
  }
  return Object.freeze(failures.sort(compareCodePoints));
}

export function resolveKnowledgeBindings(options: {
  contract: FoundationRepositoryContract;
  treeEntries: readonly FoundationGitTreeEntry[];
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  collector: DiagnosticCollector;
}): readonly ResolvedBinding[] {
  const resolved: ResolvedBinding[] = [];
  const registered = options.contract.checkBindings;
  const currentChecks = [...options.currentByIdentity.values()]
    .filter((record) => record.frontMatter.kind === "check")
    .sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id));

  for (const check of currentChecks) {
    const spec = check.frontMatter.spec as FoundationCheckSpec;
    let compatibleCount = 0;
    for (const bindingId of spec.requiredBindings) {
      const binding = registered[bindingId];
      if (binding === undefined) {
        options.collector.add({
          stage: BINDING_STAGE,
          code: "lifecycle.check.binding-missing",
          message: `Check ${check.frontMatter.id} requires unregistered Binding ${bindingId}`,
          path: check.path,
          facts: { bindingId },
        });
        continue;
      }
      const failures = compatibilityFacts({ check, binding, contract: options.contract, treeEntries: options.treeEntries });
      if (failures.length > 0) {
        options.collector.add({
          stage: BINDING_STAGE,
          code: "lifecycle.check.binding-incompatible",
          message: `Binding ${binding.id} is incompatible with Check ${check.frontMatter.id}`,
          path: check.path,
          facts: {
            bindingId: binding.id,
            checkId: check.frontMatter.id,
            failures,
            resultParser: binding.resultParser,
            subjectSelectors: binding.subjectSelectors,
          },
        });
        continue;
      }
      compatibleCount += 1;
      resolved.push(Object.freeze({ checkId: check.frontMatter.id, binding }));
    }
    if (compatibleCount === 0 && spec.requiredBindings.length > 0) {
      options.collector.add({
        stage: BINDING_STAGE,
        code: "lifecycle.check.binding-missing",
        message: `Current Check ${check.frontMatter.id} has no compatible required Binding`,
        path: check.path,
        facts: { requiredBindings: spec.requiredBindings },
      });
    }
  }

  for (const binding of Object.values(registered).sort((left, right) => compareCodePoints(left.id, right.id))) {
    for (const checkId of binding.checkIds) {
      const target = options.currentByIdentity.get(checkId);
      if (target === undefined || target.frontMatter.kind !== "check") {
        options.collector.add({
          stage: BINDING_STAGE,
          code: "lifecycle.check.binding-target-missing",
          message: `Binding ${binding.id} names missing or non-current Check ${checkId}`,
          facts: { bindingId: binding.id, checkId },
        });
      }
    }
  }

  return Object.freeze(resolved.sort((left, right) => compareCodePoints(
    `${left.checkId}\0${left.binding.id}`,
    `${right.checkId}\0${right.binding.id}`,
  )));
}

export function bindingIndex(bindings: readonly ResolvedBinding[]): ReadonlyMap<string, readonly FoundationCheckBinding[]> {
  const values = new Map<string, FoundationCheckBinding[]>();
  for (const entry of bindings) {
    const current = values.get(entry.checkId) ?? [];
    current.push(entry.binding);
    values.set(entry.checkId, current);
  }
  return new Map([...values].sort(([left], [right]) => compareCodePoints(left, right)).map(([key, entries]) => [
    key,
    Object.freeze(entries.sort((left, right) => compareCodePoints(left.id, right.id))),
  ]));
}
