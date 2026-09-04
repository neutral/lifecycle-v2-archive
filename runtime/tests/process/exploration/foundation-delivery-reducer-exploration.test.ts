import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { exploreScenario, stableJson } from "./bounded-explorer.js";
import { buildDeliveryScenarios } from "./delivery-reducer-scenarios.js";
import { DELIVERY_EVENT_KINDS } from
  "../../../src/foundation/process/delivery-event-registry.js";
import { DELIVERY_OPERATIONS } from
  "../../../src/foundation/process/operation-registry.js";
import { deliveryRecoveryDescriptors } from
  "../../../src/foundation/process/recovery-registry.js";
import {
  DELIVERY_CANDIDATE_CONDITIONS,
  DELIVERY_STANDINGS,
} from "../../../src/foundation/process/delivery-state.js";

const surveyReportEnabled =
  process.env.LIFECYCLE_RUN_DELIVERY_BOUNDED_EXPLORATION_SURVEY === "1";

function runExploration() {
  return buildDeliveryScenarios().map((scenario) => exploreScenario(scenario));
}

function stringArray(value: unknown, label: string): readonly string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const entry of value) assert.equal(typeof entry, "string", `${label} entries`);
  return value as readonly string[];
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Readonly<Record<string, unknown>>;
}

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

/**
 * Aggregate coverage imports implementation registries only to enumerate the
 * identities that at least one accepted observation must contain. This is not
 * transition coverage: trusted seed prefixes can supply event identities and
 * recovery coordinates can be endpoints. Registry values never decide whether
 * a command is legal or what state it should produce.
 */
function deliverySurfaceProjection(reports: ReturnType<typeof runExploration>) {
  const eventKinds = new Set<string>();
  const recoveryCoordinates = new Set<string>();
  const operations = new Set<string>();
  const standings = new Set<string>();
  const candidateConditions = new Set<string>();

  for (const report of reports) {
    for (const eventKind of report.coverage.eventKinds.all ?? []) eventKinds.add(eventKind);
    for (const coordinate of report.coverage.recoveryCoordinates ?? []) {
      recoveryCoordinates.add(coordinate);
    }
    for (const value of report.normalizedSemanticObservations.values) {
      const semantic = record(value.semantic, "normalized semantic observation");
      if (typeof semantic.standing === "string") standings.add(semantic.standing);
      if (typeof semantic.candidateCondition === "string") {
        candidateConditions.add(semantic.candidateCondition);
      }
      for (const activityValue of stringArray(
        Array.isArray(semantic.activities)
          ? semantic.activities.map((activity) => record(activity, "activity").operation)
          : semantic.activities,
        "semantic activities",
      )) operations.add(activityValue);
    }
  }

  const requiredRecoveryCoordinates = deliveryRecoveryDescriptors()
    .filter(({ next }) => next.type === "event")
    .map(({ kind, resumesAt }) => `${kind}/${resumesAt}`);
  const requiredOperations = DELIVERY_OPERATIONS.filter((operation) =>
    operation !== "delivery.recover");
  const missing = (required: readonly string[], actual: ReadonlySet<string>) =>
    Object.freeze([...required].filter((value) => !actual.has(value)).sort());

  return Object.freeze({
    observed: Object.freeze({
      eventKinds: sorted(eventKinds),
      recoveryCoordinates: sorted(recoveryCoordinates),
      operations: sorted(operations),
      standings: sorted(standings),
      candidateConditions: sorted(candidateConditions),
    }),
    missing: Object.freeze({
      eventKinds: missing(DELIVERY_EVENT_KINDS, eventKinds),
      recoveryCoordinates: missing(requiredRecoveryCoordinates, recoveryCoordinates),
      operations: missing(requiredOperations, operations),
      standings: missing(DELIVERY_STANDINGS, standings),
      candidateConditions: missing(
        DELIVERY_CANDIDATE_CONDITIONS,
        candidateConditions,
      ),
    }),
  });
}

function treeManifest(root: URL, prefix = ""): readonly Readonly<{
  path: string;
  digest: string;
}>[] {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      const url = new URL(entry.name, root);
      if (entry.isDirectory()) {
        return treeManifest(new URL(`${entry.name}/`, root), `${path}/`);
      }
      if (!entry.isFile()) {
        throw new TypeError(`Exploration subject contains a non-file entry: ${path}`);
      }
      const digest = createHash("sha256").update(readFileSync(url)).digest("hex");
      return [{ path, digest: `sha256:${digest}` }];
    });
}

function treeSubject(role: string, locator: string, root: URL) {
  const files = treeManifest(root);
  const digest = createHash("sha256")
    .update(stableJson(files))
    .digest("hex");
  return { role, locator, digest: `sha256:${digest}`, fileCount: files.length };
}

function surveyProjection(reports: ReturnType<typeof runExploration>) {
  return {
    reportFormat: "lifecycle.delivery-bounded-exploration-survey.v1",
    subject: {
      kind: "compiled-foundation-runtime-and-owner-adjacent-explorer",
      trees: [
        treeSubject(
          "foundation-runtime",
          "runtime/dist/src/foundation/",
          new URL("../../../src/foundation/", import.meta.url),
        ),
        treeSubject(
          "exploration-harness",
          "runtime/dist/tests/process/exploration/",
          new URL("./", import.meta.url),
        ),
      ],
    },
    tool: {
      runner: "node:test",
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      algorithm: "deterministic-breadth-first-without-state-deduplication",
    },
    claim: "Every jointly accepted history reachable from each declared seed through its declared command alphabet up to maxDepth was observed; the gate checks deterministic repeatability, exact acceptance/refusal agreement, declared scenario coverage, aggregate observation of registered reducer identities, and zero property findings.",
    assumptions: [
      "The documented runtime build completed immediately before this command.",
      "Each scenario seed is trusted setup; seed and generated event coverage are reported separately.",
      "The product-free oracle and mechanical adapter are independently reviewable but remain fallible test code.",
    ],
    exclusions: [
      "histories beyond the declared seeds, commands, and maxDepth",
      "payload values and identities not constructed by the scenarios",
      "multiple-Delivery interleavings and fairness",
      "Git, SQLite, filesystem, provider, and Backend physical effects",
      "unbounded correctness, implementation refinement, qualification, conformance, and proof",
    ],
    surface: deliverySurfaceProjection(reports),
    scenarios: reports.map((report) => ({
      scenarioId: report.scenarioId,
      clauses: report.clauses,
      bounds: report.bounds,
      dedupeMode: report.dedupeMode,
      seeds: report.seeds,
      commands: report.commands,
      transitions: report.transitions,
      depths: report.depths,
      maximumDepthReached: report.maximumDepthReached,
      frontier: report.frontier,
      coverage: report.coverage,
      normalizedSemanticObservationCount:
        report.normalizedSemanticObservations.count,
      refusalCodes: report.refusalCodes,
      findings: report.findings.map((finding) => ({
        signature: finding.signature,
        source: finding.source,
        seedId: finding.seedId,
        depth: finding.depth,
        trace: finding.trace,
        finding: finding.finding,
      })),
    })),
  };
}

function gateProjection(reports: ReturnType<typeof runExploration>) {
  const surface = deliverySurfaceProjection(reports);
  return {
    coverageGaps: reports
      .filter((report) => !report.coverage.requirements.satisfied)
      .map((report) => ({
        scenarioId: report.scenarioId,
        missing: report.coverage.requirements.missing,
      })),
    expectationMismatches: reports.reduce(
      (total, report) => total + report.transitions.expectationMismatches,
      0,
    ),
    unclassifiedRefusalExpectations: reports.reduce(
      (total, report) =>
        total + report.transitions.unclassifiedRefusalExpectations,
      0,
    ),
    surfaceGaps: surface.missing,
    findings: reports.flatMap((report) => report.findings.map((finding) => ({
      scenarioId: report.scenarioId,
      signature: finding.signature,
      source: finding.source,
      seedId: finding.seedId,
      trace: finding.trace,
    }))),
  };
}

/**
 * The optional survey projection makes the required gate's exact finite claim
 * inspectable without snapshotting or allow-listing successful output.
 */
test(
  "bounded Delivery reducer exploration survey is reproducible",
  (context) => {
    const first = runExploration();
    const second = runExploration();

    assert.equal(stableJson(first), stableJson(second));
    assert.deepEqual(
      gateProjection(first).coverageGaps,
      [],
      "bounded exploration did not satisfy its declared survey coverage",
    );
    assert.equal(
      gateProjection(first).expectationMismatches,
      0,
      "bounded exploration found an acceptance/refusal or classified-diagnostic disagreement",
    );
    if (surveyReportEnabled) {
      context.diagnostic(
        `bounded-exploration-survey.v1 ${stableJson(surveyProjection(first))}`,
      );
    }
  },
);

/**
 * The required gate admits no known-finding baseline. Any mismatch, missing
 * aggregate registered-identity observation, unclassified refusal, or property
 * finding fails.
 */
test(
  "bounded Delivery reducer exploration has no findings and satisfies declared coverage",
  () => {
    const first = runExploration();
    const second = runExploration();
    assert.deepEqual(
      {
        deterministic: stableJson(first) === stableJson(second),
        ...gateProjection(first),
      },
      {
        deterministic: true,
        coverageGaps: [],
        expectationMismatches: 0,
        unclassifiedRefusalExpectations: 0,
        surfaceGaps: {
          eventKinds: [],
          recoveryCoordinates: [],
          operations: [],
          standings: [],
          candidateConditions: [],
        },
        findings: [],
      },
      "bounded exploration is not gate-ready",
    );
  },
);
