#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { target: "sample-target" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--help") {
      console.log("Usage: node setup/verify-installed-methodology.mjs [--target sample-target]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function normalizeSearch(text) {
  return text.replace(/\s+/g, " ").toLowerCase();
}

function includesAny(haystack, choices) {
  return choices.some((choice) => haystack.includes(choice.toLowerCase()));
}

function requireConcept(haystack, label, choices) {
  if (!includesAny(haystack, choices)) {
    throw new Error(`records/context/overview.md is missing Context atlas concept: ${label} (${choices.join(" | ")})`);
  }
}

function walk(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function isLocalMarkdownLink(link) {
  return link
    && !link.startsWith("#")
    && !link.startsWith("mailto:")
    && !/^[a-z][a-z0-9+.-]*:/i.test(link);
}

function targetPart(link) {
  const hashIndex = link.indexOf("#");
  return hashIndex === -1 ? link : link.slice(0, hashIndex);
}

function decodeLinkTarget(link) {
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function verifyInstalledMarkdownLinks(root) {
  const lifecycleRoot = path.join(root, ".lifecycle");
  const markdownFiles = walk(lifecycleRoot).filter((file) => file.endsWith(".md"));
  const missing = [];
  const linkPattern = /(?<!!)\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const file of markdownFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(linkPattern)) {
      const rawLink = match[1] ?? "";
      if (!isLocalMarkdownLink(rawLink)) continue;
      const rawTarget = targetPart(rawLink);
      if (!rawTarget) continue;
      const target = path.resolve(path.dirname(file), decodeLinkTarget(rawTarget));
      if (!fs.existsSync(target)) {
        missing.push({
          file: path.relative(root, file),
          link: rawLink,
          target: path.relative(root, target)
        });
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Installed Markdown local links point to missing targets:\n${missing.map((item) => `- ${item.file}: ${item.link} -> ${item.target}`).join("\n")}`);
  }
}

function walkDirs(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  found.push(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...walkDirs(path.join(dir, entry.name)));
  }
  return found;
}

function verify(args) {
  const root = path.resolve(args.target);
  const required = [
    ".lifecycle/methodology/start.md",
    ".lifecycle/methodology/route.md",
    ".lifecycle/methodology/registry.md",
    ".lifecycle/methodology/processes/invocation.md",
    ".lifecycle/methodology/processes/processes.md",
    ".lifecycle/methodology/processes/clarity/overview.md",
    ".lifecycle/methodology/processes/clarity/process.md",
    ".lifecycle/methodology/processes/clarity/gates.md",
    ".lifecycle/methodology/processes/clarity/phases/intake.md",
    ".lifecycle/methodology/processes/clarity/phases/source-inventory.md",
    ".lifecycle/methodology/processes/clarity/phases/atlas-routing.md",
    ".lifecycle/methodology/processes/clarity/phases/content-adequacy.md",
    ".lifecycle/methodology/processes/clarity/phases/canonicalization.md",
    ".lifecycle/methodology/processes/clarity/phases/promotion-pressure.md",
    ".lifecycle/methodology/processes/clarity/phases/retrieval-proof.md",
    ".lifecycle/methodology/processes/clarity/phases/closure.md",
    ".lifecycle/methodology/processes/clarity/control-records/overview.md",
    ".lifecycle/methodology/processes/clarity/control-records/clarity-boundary.md",
    ".lifecycle/methodology/processes/clarity/control-records/source-inventory.md",
    ".lifecycle/methodology/processes/clarity/control-records/context-review-packet.md",
    ".lifecycle/methodology/processes/clarity/control-records/clarity-closure-record.md",
    ".lifecycle/methodology/processes/discovery/overview.md",
    ".lifecycle/methodology/processes/discovery/process.md",
    ".lifecycle/methodology/processes/discovery/gates.md",
    ".lifecycle/methodology/processes/discovery/control-records/overview.md",
    ".lifecycle/methodology/processes/discovery/control-records/plan-map.md",
    ".lifecycle/methodology/processes/discovery/control-records/plan-item.md",
    ".lifecycle/methodology/processes/discovery/control-records/selection-handoff.md",
    ".lifecycle/methodology/processes/delivery/overview.md",
    ".lifecycle/methodology/processes/delivery/process.md",
    ".lifecycle/methodology/processes/delivery/gates.md",
    ".lifecycle/methodology/processes/delivery/phases/signal.md",
    ".lifecycle/methodology/processes/delivery/phases/framing.md",
    ".lifecycle/methodology/processes/delivery/phases/build.md",
    ".lifecycle/methodology/processes/delivery/phases/evidence-and-reconciliation.md",
    ".lifecycle/methodology/processes/delivery/phases/release-and-learning.md",
    ".lifecycle/methodology/processes/delivery/control-records/overview.md",
    ".lifecycle/methodology/processes/delivery/control-records/work-boundary.md",
    ".lifecycle/methodology/processes/delivery/control-records/evidence-packet.md",
    ".lifecycle/methodology/processes/delivery/control-records/landing-packet.md",
    ".lifecycle/methodology/processes/delivery/control-records/release-summary.md",
    ".lifecycle/methodology/processes/delivery/control-records/knowledge-promotion-decision.md",
    ".lifecycle/methodology/processes/delivery/control-records/archive-decision.md",
    ".lifecycle/methodology/processes/delivery/control-records/closure-record.md",
    ".lifecycle/methodology/states/clarity-active.md",
    ".lifecycle/methodology/states/work-boundary-active.md",
    ".lifecycle/methodology/control-records/overview.md",
    ".lifecycle/methodology/control-records/clarity-boundary.md",
    ".lifecycle/methodology/control-records/source-inventory.md",
    ".lifecycle/methodology/control-records/context-review-packet.md",
    ".lifecycle/methodology/control-records/clarity-closure-record.md",
    ".lifecycle/methodology/control-records/work-boundary.md",
    ".lifecycle/methodology/control-records/evidence-packet.md",
    ".lifecycle/methodology/control-records/landing-packet.md",
    ".lifecycle/methodology/control-records/closure-record.md",
    ".lifecycle/methodology/control-records/plan-map.md",
    ".lifecycle/methodology/local-support/overview.md",
    ".lifecycle/methodology/local-support/work-trace.md",
    ".lifecycle/methodology/local-support/stop-work-request.md",
    ".lifecycle/methodology/local-support/tooling-support.md",
    ".lifecycle/methodology/disciplines/overview.md",
    ".lifecycle/methodology/disciplines/package-contract.md",
    ".lifecycle/methodology/disciplines/use-discipline.md",
    ".lifecycle/methodology/disciplines/binding-contract.md",
    ".lifecycle/methodology/disciplines/surface-contract.md",
    ".lifecycle/methodology/disciplines/checks/usage-adequacy.md",
    ".lifecycle/disciplines/catalog.md",
    ".lifecycle/disciplines/discipline.lock",
    ".lifecycle/methodology/semantic-authority/surfaces/overview.md",
    ".lifecycle/methodology/semantic-authority/surfaces/contract.md",
    ".lifecycle/methodology/semantic-authority/surfaces/update-procedure.md",
    ".lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml",
    ".lifecycle/methodology/semantic-authority/update-product-meaning.md",
    ".lifecycle/methodology/semantic-authority/templates/context-entry.md",
    ".lifecycle/methodology/semantic-authority/templates/intent-entry.md",
    ".lifecycle/methodology/semantic-authority/templates/assurance-entry.md",
    ".lifecycle/methodology/semantic-authority/templates/blueprint-entry.md",
    ".lifecycle/methodology/semantic-authority/templates/description-entry.md",
    ".lifecycle/methodology/checks/before-build.md",
    ".lifecycle/methodology/checks/before-proof.md",
    ".lifecycle/methodology/checks/before-landing.md",
    ".lifecycle/methodology/checks/before-closure.md",
    ".lifecycle/methodology/responses/reframe.md",
    ".lifecycle/methodology.lock",
    ".lifecycle/scratch/overview.md",
    "records/overview.md",
    "records/context/overview.md",
    "records/intent/overview.md",
    "records/assurance/overview.md",
    "records/blueprint/overview.md",
    "records/control/overview.md",
    "records/control/clarity/overview.md",
    "records/control/clarity/boundaries/overview.md",
    "records/control/clarity/inventories/overview.md",
    "records/control/clarity/reviews/overview.md",
    "records/control/clarity/closures/overview.md",
    "records/control/discovery/overview.md",
    "records/control/discovery/maps/overview.md",
    "records/control/discovery/plans/overview.md",
    "records/control/discovery/selections/overview.md",
    "records/control/delivery/overview.md",
    "records/control/delivery/work-boundaries/overview.md",
    "records/control/delivery/evidence/overview.md",
    "records/control/delivery/landings/overview.md",
    "records/control/delivery/releases/overview.md",
    "records/control/delivery/promotions/overview.md",
    "records/control/delivery/archives/overview.md",
    "records/control/delivery/closures/overview.md"
  ];

  const missing = required.filter((item) => !exists(root, item));
  if (missing.length > 0) {
    throw new Error(`Missing required files:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }

  const requiredDirs = [
    ".lifecycle/disciplines/package-info",
    ".lifecycle/disciplines/bindings",
    ".lifecycle/disciplines/surfaces",
    ".lifecycle/disciplines/cache",
    ".lifecycle/work-traces",
    ".lifecycle/stop-work-requests"
  ];
  const missingDirs = requiredDirs.filter((item) => !exists(root, item));
  if (missingDirs.length > 0) {
    throw new Error(`Missing required directories:\n${missingDirs.map((item) => `- ${item}`).join("\n")}`);
  }

  const sourceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const usageSourceCandidates = [
    path.join(sourceRoot, "tools", "usage"),
    path.join(sourceRoot, "usage", "tools")
  ];
  const toolsUsageSource = usageSourceCandidates.find((candidate) => fs.existsSync(candidate));
  if (!toolsUsageSource) {
    throw new Error("Missing tool usage docs in the source repo: expected tools/usage or usage/tools");
  }
  const expectedToolsDocs = fs.readdirSync(toolsUsageSource).filter((file) => file.endsWith(".md"));
  const missingToolsDocs = expectedToolsDocs.filter((file) => !exists(root, path.join(".lifecycle/usage/tools", file)));
  if (missingToolsDocs.length > 0) {
    throw new Error(`Missing installed usage docs:\n${missingToolsDocs.map((item) => `- .lifecycle/usage/tools/${item}`).join("\n")}`);
  }

  verifyInstalledMarkdownLinks(root);

  const legacyInstalledRecords = ".lifecycle/methodology/records";
  if (exists(root, legacyInstalledRecords)) {
    throw new Error(`Legacy installed methodology records folder still exists: ${legacyInstalledRecords}`);
  }

  const legacyInstalledAuthority = ".lifecycle/methodology/authority";
  if (exists(root, legacyInstalledAuthority)) {
    throw new Error(`Legacy installed methodology authority folder still exists: ${legacyInstalledAuthority}`);
  }

  const misplacedRecordOrDiscipline = [
    "records/product",
    "records/process",
    "records/description",
    "records/disciplines",
    "records/control/disciplines",
    ".lifecycle/disciplines/packages",
    ".lifecycle/methodology/disciplines/surfaces",
    ".lifecycle/methodology/disciplines/bindings"
  ].filter((item) => exists(root, item));
  if (misplacedRecordOrDiscipline.length > 0) {
    throw new Error(`Record or discipline material is in the wrong location:\n${misplacedRecordOrDiscipline.map((item) => `- ${item}`).join("\n")}`);
  }

  const recordsRoot = path.join(root, "records");
  const missingOverview = walkDirs(recordsRoot)
    .filter((dir) => !fs.existsSync(path.join(dir, "overview.md")))
    .map((dir) => path.relative(root, dir));

  const uniqueMissing = [...new Set(missingOverview)];
  if (uniqueMissing.length > 0) {
    throw new Error(`Record folders missing overview.md:\n${uniqueMissing.map((item) => `- ${item}`).join("\n")}`);
  }

  const wrongOverviewNames = walk(recordsRoot).filter((file) => ["README.md", "index.md"].includes(path.basename(file)));
  if (wrongOverviewNames.length > 0) {
    throw new Error(`Wrong overview filenames under records/:\n${wrongOverviewNames.map((item) => `- ${path.relative(root, item)}`).join("\n")}`);
  }

  const registry = read(root, ".lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml");
  for (const required of ["retrieval_keys:", "target_references:", "adequacy_checks:", "promotion_candidates:"]) {
    if (!registry.includes(required)) throw new Error(`Semantic authority registry is missing ${required}`);
  }
  if (registry.includes("record_root:")) {
    throw new Error("Semantic authority registry must use storage_locator, not record_root");
  }
  if (!registry.includes('id: "description"') || !registry.includes('storage_locator: "**/_*.desc.md"')) {
    throw new Error("Semantic authority registry must place Description entries in code-adjacent _*.desc.md files");
  }
  const contextRegistryBlock = registry.match(/\n  - id: "context"[\s\S]*?(?=\n  - id: "|$)/)?.[0] ?? "";
  if (!contextRegistryBlock) {
    throw new Error("Semantic authority registry is missing Context surface block");
  }
  for (const required of [
    "may_reference:",
    '- "intent"',
    '- "assurance"',
    '- "blueprint"',
    '- "description"',
    "`child_contexts`, and `context_relations` fields",
    "individual leaves reviewed unless their owned meaning was actually checked",
    "proof receipts, one-run proof results"
  ]) {
    if (!contextRegistryBlock.includes(required)) {
      throw new Error(`Context registry block is missing full generated guidance: ${required}`);
    }
  }

  for (const surface of ["context", "intent", "assurance", "blueprint", "description"]) {
    const template = read(root, `.lifecycle/methodology/semantic-authority/templates/${surface}-entry.md`);
    for (const required of ["retrieval_keys:", "target_references:", "related_surfaces:", "Body Shape Guidance", "Adequacy Checks", "Promotion Candidates", "Minimal Seed Example"]) {
      if (!template.includes(required)) throw new Error(`${surface} entry template is missing ${required}`);
    }
    if (template.includes("source_basis:")) {
      throw new Error(`${surface} entry template must not include source_basis`);
    }
    if (!template.includes("Provenance Boundary")) {
      throw new Error(`${surface} entry template is missing Provenance Boundary`);
    }
  }

  const contextTemplate = read(root, ".lifecycle/methodology/semantic-authority/templates/context-entry.md");
  const contextTemplateSearch = contextTemplate.replace(/\s+/g, " ");
  if (contextTemplate.includes("No may-reference surface is declared.")) {
    throw new Error("context entry template must declare downstream may-reference surfaces");
  }
  for (const required of [
    "context_area:",
    "context_cluster:",
    "context_role:",
    "parent_context:",
    "child_contexts:",
    "context_relations:",
    "Context Atlas Fields",
    "area overviews",
    "semantic neighborhoods",
    "canonical references",
    "rationale leaves",
    "promotion pressure",
    "Route Review Boundary",
    "Leaf Review Status",
    "May reference: - intent - assurance - blueprint - description",
    "`relation:target` form",
    "review_status",
    "freshness",
    "proof receipts, one-run proof results"
  ]) {
    if (!contextTemplateSearch.includes(required)) {
      throw new Error(`context entry template is missing Context atlas guidance: ${required}`);
    }
  }

  const contextOverview = read(root, "records/context/overview.md");
  const contextOverviewSearch = normalizeSearch(contextOverview);
  for (const concept of [
    {
      label: "atlas purpose",
      choices: ["broad product-context atlas organization", "context atlas", "product-context atlas"]
    },
    {
      label: "product-area routes",
      choices: ["product-area and cluster subfolders", "product-area", "product area"]
    },
    {
      label: "cluster routes",
      choices: ["product-area and cluster subfolders", "cluster subfolders", "cluster", "clusters"]
    },
    {
      label: "area overviews",
      choices: ["area overviews", "area overview", "area route", "area routes"]
    },
    {
      label: "canonical references",
      choices: ["canonical references", "canonical reference", "canonical entries"]
    },
    {
      label: "rationale leaves",
      choices: ["rationale leaves", "rationale leaf", "supporting rationale"]
    },
    {
      label: "semantic neighborhoods",
      choices: ["semantic neighborhoods", "semantic neighborhood", "product routes"]
    },
    {
      label: "promotion pressure",
      choices: ["promotion pressure", "follow-up surface", "future intent", "future assurance", "future blueprint", "future description"]
    }
  ]) {
    requireConcept(contextOverviewSearch, concept.label, concept.choices);
  }

  const methodologyRegistry = read(root, ".lifecycle/methodology/registry.md");
  for (const required of [
    "Discipline",
    "../disciplines/catalog.md",
    "disciplines/overview.md",
    "Local Support",
    "processes/clarity/process.md",
    "states/clarity-active.md",
    "control-records/clarity-boundary.md",
    "control-records/context-review-packet.md",
    "control-records/plan-map.md",
    "local-support/work-trace.md",
    "local-support/stop-work-request.md",
    "local-support/tooling-support.md"
  ]) {
    if (!methodologyRegistry.includes(required)) throw new Error(`Installed registry is missing ${required}`);
  }

  const startPage = read(root, ".lifecycle/methodology/start.md");
  for (const required of ["start the next independent", "fresh `records/control/`", "Clarity Boundary"]) {
    if (!startPage.includes(required)) throw new Error(`Installed start page is missing new-process guidance: ${required}`);
  }

  const invocationPage = read(root, ".lifecycle/methodology/processes/invocation.md");
  for (const required of ["Starting A New Process", "not shared mutable state", "Clarity Resume", "active Clarity Boundary"]) {
    if (!invocationPage.includes(required)) {
      throw new Error(`Installed invocation page is missing new-process guidance: ${required}`);
    }
  }

  const controlOverview = read(root, ".lifecycle/methodology/control-records/overview.md");
  for (const required of ["process-local current state", "Do not share mutable Control"]) {
    if (!controlOverview.includes(required)) throw new Error(`Installed control overview is missing process-local guidance: ${required}`);
  }

  const workBoundary = read(root, ".lifecycle/methodology/control-records/work-boundary.md");
  for (const required of ["product_judgment", "Product judgment", "supports admitting"]) {
    if (!workBoundary.includes(required)) throw new Error(`Installed Work Boundary page is missing product judgment guidance: ${required}`);
  }

  const evidencePacket = read(root, ".lifecycle/methodology/control-records/evidence-packet.md");
  if (!evidencePacket.includes("product_judgment_coverage")) {
    throw new Error("Installed Evidence Packet page is missing product_judgment_coverage");
  }

  const landingPacket = read(root, ".lifecycle/methodology/control-records/landing-packet.md");
  if (!landingPacket.includes("product_judgment_coverage")) {
    throw new Error("Installed Landing Packet page is missing product_judgment_coverage");
  }

  const closureRecord = read(root, ".lifecycle/methodology/control-records/closure-record.md");
  if (!closureRecord.includes("product_judgment_outcome")) {
    throw new Error("Installed Closure Record page is missing product_judgment_outcome");
  }

  const clarityBoundary = read(root, ".lifecycle/methodology/control-records/clarity-boundary.md");
  for (const required of ["review_depth", "no_auto_start_rule", "semantic_authority_boundaries"]) {
    if (!clarityBoundary.includes(required)) throw new Error(`Installed Clarity Boundary page is missing ${required}`);
  }

  const contextReviewPacket = read(root, ".lifecycle/methodology/control-records/context-review-packet.md");
  for (const required of ["surface_contract", "route_checks", "content_adequacy_checks", "promotion_pressure_checks", "retrieval_checks"]) {
    if (!contextReviewPacket.includes(required)) throw new Error(`Installed Context Review Packet page is missing ${required}`);
  }

  const clarityProcess = read(root, ".lifecycle/methodology/processes/clarity/process.md");
  for (const required of ["does not automatically start Discovery or Delivery", "Context Contract", "Context Review Packet", "recommendations"]) {
    if (!clarityProcess.includes(required)) throw new Error(`Installed Clarity process page is missing ${required}`);
  }

  const beforeBuild = read(root, ".lifecycle/methodology/checks/before-build.md");
  for (const required of ["product judgment is present", "recommendation basis supports the product judgment"]) {
    if (!beforeBuild.includes(required)) throw new Error(`Installed before-build check is missing product judgment check: ${required}`);
  }

  const disciplineCatalog = read(root, ".lifecycle/disciplines/catalog.md");
  for (const required of [
    "Installed Discipline Packages",
    "Use this installed catalog to discover discipline packages"
  ]) {
    if (!disciplineCatalog.includes(required)) throw new Error(`Discipline catalog is missing ${required}`);
  }

  if (exists(root, ".lifecycle/tooling")) {
    const toolingRequired = [
      ".lifecycle/tooling/support/contract-registry.json",
      ".lifecycle/tooling/support/check-registry.contract.json",
      ".lifecycle/tooling/support/tool-config.contract.json",
      ".lifecycle/tooling/support/tool-observations.contract.json",
      ".lifecycle/tooling/support/control-records/clarity/clarity-boundary.contract.json",
      ".lifecycle/tooling/support/control-records/clarity/source-inventory.contract.json",
      ".lifecycle/tooling/support/control-records/clarity/context-review-packet.contract.json",
      ".lifecycle/tooling/support/control-records/clarity/clarity-closure-record.contract.json",
      ".lifecycle/tooling/support/control-records/discovery/plan-map.contract.json",
      ".lifecycle/tooling/support/control-records/discovery/plan-item.contract.json",
      ".lifecycle/tooling/support/control-records/discovery/selection-handoff.contract.json",
      ".lifecycle/tooling/support/control-records/delivery/work-boundary.contract.json",
      ".lifecycle/tooling/support/control-records/delivery/evidence-packet.contract.json",
      ".lifecycle/tooling/support/control-records/delivery/landing-packet.contract.json",
      ".lifecycle/tooling/support/control-records/delivery/closure-record.contract.json",
      ".lifecycle/tooling/tooling.lock.json"
    ];
    const missingTooling = toolingRequired.filter((item) => !exists(root, item));
    if (missingTooling.length > 0) {
      throw new Error(`Missing tooling support files:\n${missingTooling.map((item) => `- ${item}`).join("\n")}`);
    }

    const toolingContractFields = {
      ".lifecycle/tooling/support/control-records/clarity/clarity-boundary.contract.json": "no_auto_start_rule",
      ".lifecycle/tooling/support/control-records/clarity/source-inventory.contract.json": "source_treatment",
      ".lifecycle/tooling/support/control-records/clarity/context-review-packet.contract.json": "surface_contract",
      ".lifecycle/tooling/support/control-records/clarity/clarity-closure-record.contract.json": "no_auto_start_confirmation",
      ".lifecycle/tooling/support/control-records/delivery/work-boundary.contract.json": "product_judgment",
      ".lifecycle/tooling/support/control-records/delivery/evidence-packet.contract.json": "product_judgment_coverage",
      ".lifecycle/tooling/support/control-records/delivery/landing-packet.contract.json": "product_judgment_coverage",
      ".lifecycle/tooling/support/control-records/delivery/closure-record.contract.json": "product_judgment_outcome"
    };
    for (const [contractPath, requiredField] of Object.entries(toolingContractFields)) {
      if (!read(root, contractPath).includes(requiredField)) {
        throw new Error(`Tooling support contract ${contractPath} is missing ${requiredField}`);
      }
    }

    const contractRegistry = readJson(root, ".lifecycle/tooling/support/contract-registry.json");
    if (contractRegistry.schema_version !== "lifecycle.tooling.contract-registry.v1") {
      throw new Error("Tooling contract registry has the wrong schema version");
    }
    for (const contract of contractRegistry.contracts ?? []) {
      const installPath = path.join(".lifecycle/tooling", contract.install_path);
      if (!exists(root, installPath)) throw new Error(`Missing installed tooling contract: ${installPath}`);
      if (!contract.source_hash) throw new Error(`Tooling contract is missing source hash: ${contract.id}`);
    }

    const toolingLock = readJson(root, ".lifecycle/tooling/tooling.lock.json");
    if (toolingLock.schema_version !== "lifecycle.tooling.lock.v1") {
      throw new Error("Tooling lock has the wrong schema version");
    }
    if (!toolingLock.freshness_inputs?.methodology_lock_hash) {
      throw new Error("Tooling lock is missing methodology lock freshness input");
    }
    if (!toolingLock.freshness_inputs?.contract_registry_hash) {
      throw new Error("Tooling lock is missing contract registry freshness input");
    }
  }

  console.log(`Verified installed methodology in ${root}`);
}

try {
  verify(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
