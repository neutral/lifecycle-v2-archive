#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SURFACE_MANIFEST_FIELD_HEADINGS = [
  "Owns",
  "May reference",
  "Backpressure to",
  "Updated by",
  "Retrieval keys",
  "Target references",
  "Adequacy checks",
  "Promotion candidates",
  "Body shapes",
  "Minimal seed example"
];
const REQUIRED_SURFACE_SEEDS = new Set(["context", "intent", "assurance", "blueprint", "description"]);

function readText(relativePath) {
  return fs.readFileSync(resolvePath(relativePath), "utf8");
}

function resolvePath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function resolveProfilePath(inputPath) {
  if (path.isAbsolute(inputPath)) return inputPath;
  const cwdPath = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(cwdPath)) return cwdPath;
  return resolvePath(inputPath);
}

function repoRelativePath(inputPath) {
  return path.relative(repoRoot, inputPath).replaceAll("\\", "/");
}

function resolveProfileReference(inputPath, profilePath) {
  if (path.isAbsolute(inputPath)) return repoRelativePath(inputPath);
  const profileRelativePath = path.resolve(path.dirname(profilePath), inputPath);
  if (fs.existsSync(profileRelativePath)) return repoRelativePath(profileRelativePath);
  return inputPath.replaceAll("\\", "/");
}

function resolveManifestReference(inputPath, manifestPath) {
  if (path.isAbsolute(inputPath)) return repoRelativePath(inputPath);
  const manifestRelativePath = path.resolve(path.dirname(manifestPath), inputPath);
  if (fs.existsSync(manifestRelativePath)) return repoRelativePath(manifestRelativePath);
  return inputPath.replaceAll("\\", "/");
}

function resolveTargetPath(inputPath) {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`);
}

function writeTextIfMissing(filePath, text) {
  if (fs.existsSync(filePath)) return;
  writeText(filePath, text);
}

function ensureLine(filePath, line) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter((item) => item.length > 0);
  if (lines.includes(line)) return;
  const next = existing.endsWith("\n") || existing.length === 0
    ? `${existing}${line}\n`
    : `${existing}\n${line}\n`;
  fs.writeFileSync(filePath, next);
}

function copyFile(sourceRelative, targetPath) {
  const sourcePath = path.join(repoRoot, sourceRelative);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source file: ${sourceRelative}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyProcessRecordReference(processId, sourceRelative, targetPath) {
  const sourcePath = path.join(repoRoot, sourceRelative);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source file: ${sourceRelative}`);
  }
  const text = fs.readFileSync(sourcePath, "utf8")
    .replaceAll("](../../control/", "](../processes/control/")
    .replaceAll("](../gates.md", `](../processes/${processId}/gates.md`)
    .replaceAll("](../phases/", `](../processes/${processId}/phases/`);
  writeText(targetPath, text);
}

function contentHash(text) {
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  return `sha256:${hash}`;
}

function disciplinePackageInfoPath(packageId) {
  const normalized = packageId.trim().replaceAll(".", "/");
  if (!normalized) {
    throw new Error("Discipline package is missing package_id for package info path.");
  }
  return path.posix.join("package-info", `${normalized}.md`);
}

function parseArgs(argv) {
  const args = {
    profile: "setup/install-profiles/core.md",
    target: "sample-target",
    cleanMethodology: false,
    resetRecords: false,
    startNewProcess: false,
    toolingSupport: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--target") args.target = argv[++i];
    else if (arg === "--clean") args.cleanMethodology = true;
    else if (arg === "--reset-records") args.resetRecords = true;
    else if (arg === "--start-new-process") args.startNewProcess = true;
    else if (arg === "--with-tooling") args.toolingSupport = true;
    else if (arg === "--no-clean") {
      args.cleanMethodology = false;
      args.resetRecords = false;
      args.startNewProcess = false;
    } else if (arg === "--help") {
      console.log(
        "Usage: node setup/compile-install-helper.mjs [--profile setup/install-profiles/core.md] [--target sample-target] [--clean] [--start-new-process] [--reset-records] [--with-tooling]\n\n--profile may be source-root relative, current-working-directory relative, or absolute. --target may be current-working-directory relative or absolute."
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function section(text, heading) {
  return h2Sections(text).find((item) => item.heading === heading)?.body.trim() ?? "";
}

function h2Sections(text) {
  const lines = text.split("\n");
  const result = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (current) result.push(current);
      current = { heading: match[1].trim(), body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }

  if (current) result.push(current);
  return result;
}

function parseSimpleTable(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|\s*-+/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length > 0);
}

function parseFieldTable(text) {
  const rows = parseSimpleTable(text);
  const result = {};
  for (const row of rows.slice(1)) {
    result[row[0].toLowerCase().replaceAll(" ", "_")] = row[1];
  }
  return result;
}

function parseObjectTable(text) {
  const rows = parseSimpleTable(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.toLowerCase().replaceAll(" ", "_"));
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseFirstYamlFenceFromText(text) {
  const match = text.match(/```yaml\n([\s\S]*?)\n```/);
  return match?.[1]?.trim() ?? "";
}

function yamlHeaderScalar(block, key) {
  const match = block.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return unquoteYaml(match[1].trim());
}

function yamlList(block, key) {
  const lines = yamlIndentedBlock(block, key);
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !/^[A-Za-z0-9_]+:\s*/.test(line.slice(2)))
    .map((line) => unquoteYaml(line.slice(2).trim()));
}

function yamlObjectIds(block, key) {
  return yamlIndentedBlock(block, key)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- id:"))
    .map((line) => unquoteYaml(line.slice("- id:".length).trim()));
}

function yamlNestedList(block, parentKey, childKey) {
  const parentLines = yamlIndentedBlock(block, parentKey);
  const result = [];
  for (let index = 0; index < parentLines.length; index += 1) {
    const line = parentLines[index];
    if (line.trim() !== `${childKey}:`) continue;
    const childIndent = line.match(/^\s*/)[0].length;
    for (const childLine of parentLines.slice(index + 1)) {
      const indent = childLine.match(/^\s*/)[0].length;
      const trimmed = childLine.trim();
      if (trimmed.length === 0) continue;
      if (indent <= childIndent) break;
      if (trimmed.startsWith("- ")) result.push(unquoteYaml(trimmed.slice(2).trim()));
    }
  }
  return result;
}

function yamlIndentedBlock(block, key) {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z0-9_]+:/.test(line)) break;
    result.push(line);
  }
  return result;
}

function unquoteYaml(value) {
  return value.replace(/^"(.+)"$/, "$1").replace(/^'(.+)'$/, "$1");
}

function parseListSection(text, heading) {
  return section(text, heading)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function stripFirstYamlFence(text) {
  return text.replace(/```yaml\n[\s\S]*?\n```\n?/, "").trim();
}

function titleFromMarkdown(text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function extractBeforeH2Prefix(text, prefix) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## "));
  if (start === -1) return "";
  const result = [];
  for (const line of lines.slice(start)) {
    if (line.startsWith(prefix)) break;
    result.push(line);
  }
  return result.join("\n").trim();
}

function h2SectionsWithPrefix(text, prefix) {
  return h2Sections(text).filter((item) => item.heading.startsWith(prefix));
}

function promoteBindingHeadings(text) {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("#### ")) return line.replace(/^#### /, "### ");
      if (line.startsWith("### ")) return line.replace(/^### /, "## ");
      return line;
    })
    .join("\n")
    .trim();
}

function parseProfile(relativePath) {
  const profilePath = resolveProfilePath(relativePath);
  const text = fs.readFileSync(profilePath, "utf8");
  return {
    packageSelection: parseFieldTable(section(text, "Package Selection")),
    processes: parseListSection(text, "Processes"),
    semanticAuthoritySurfaces: parseListSection(text, "Semantic Authority Surfaces"),
    disciplinePackageManifests: parseListSection(text, "Discipline Package Manifests")
      .map((manifestPath) => resolveProfileReference(manifestPath, profilePath)),
    disciplinePackages: parseListSection(text, "Discipline Packages"),
    output: parseFieldTable(section(text, "Output"))
  };
}

function parseCoreManifest() {
  const text = readText("methodology/package-manifest.md");
  return {
    package: parseFieldTable(section(text, "Package")),
    installedSourcePages: parseObjectTable(section(text, "Installed Source Pages")),
    checks: parseObjectTable(section(text, "Checks")),
    toolingContracts: parseObjectTable(section(text, "Tooling Contracts")),
    semanticAuthorityOperations: parseObjectTable(section(text, "Semantic Authority Operations")),
    semanticAuthorityChecks: parseObjectTable(section(text, "Semantic Authority Checks")),
    responses: parseObjectTable(section(text, "Responses"))
  };
}

function parseProcessManifest(relativePath) {
  const text = readText(relativePath);
  return {
    package: parseFieldTable(section(text, "Package")),
    entryConditions: parseListSection(text, "Entry Conditions"),
    states: parseListSection(text, "States"),
    installedSourcePages: parseObjectTable(section(text, "Installed Source Pages")),
    records: parseObjectTable(section(text, "Records")),
    handoffsIn: parseListSection(text, "Handoffs In"),
    handoffsOut: parseListSection(text, "Handoffs Out"),
    semanticAuthorityOperations: parseListSection(text, "Required Semantic Authority Operations")
  };
}

function parseSurfaceManifest() {
  const text = readText("methodology/semantic-authority/surfaces/package-manifest.md");
  const surfaces = parseObjectTable(section(text, "Surfaces"));

  for (const surface of surfaces) {
    const heading = surface.name;
    surface.owns = parseNamedListInSurface(text, heading, "Owns");
    surface.may_reference = withoutNone(parseNamedListInSurface(text, heading, "May reference"));
    surface.backpressure_to = withoutNone(parseNamedListInSurface(text, heading, "Backpressure to"));
    surface.updated_by = parseNamedListInSurface(text, heading, "Updated by");
    surface.retrieval_keys = parseNamedListInSurface(text, heading, "Retrieval keys");
    surface.target_references = withoutNone(parseNamedListInSurface(text, heading, "Target references"));
    surface.adequacy_checks = parseNamedListInSurface(text, heading, "Adequacy checks");
    surface.promotion_candidates = parseNamedListInSurface(text, heading, "Promotion candidates");
    surface.body_shapes = parseNamedBlockInSurface(text, heading, "Body shapes");
    surface.minimal_seed_example = parseNamedBlockInSurface(text, heading, "Minimal seed example");
  }

  return surfaces;
}

function parseDisciplineManifest(relativePath) {
  const manifestPath = resolvePath(relativePath);
  const text = fs.readFileSync(manifestPath, "utf8");
  const packageInfo = parseFieldTable(section(text, "Package"));
  packageInfo.source_root = resolveManifestReference(packageInfo.source_root, manifestPath);
  const packages = parseObjectTable(section(text, "Discipline Packages"));

  for (const disciplinePackage of packages) {
    const sourceText = readText(path.join(packageInfo.source_root, disciplinePackage.source));
    const header = parseFirstYamlFenceFromText(sourceText);
    const bindingSections = h2SectionsWithPrefix(sourceText, "Binding: ");
    const sourcePath = path.posix.join(packageInfo.source_root, disciplinePackage.source);
    disciplinePackage.source_root = packageInfo.source_root;
    disciplinePackage.source_manifest = relativePath;
    disciplinePackage.source_path = sourcePath;
    disciplinePackage.source_hash = contentHash(sourceText);
    disciplinePackage.package_info_path = disciplinePackageInfoPath(disciplinePackage.id);
    disciplinePackage.title = titleFromMarkdown(sourceText);
    disciplinePackage.surface_content = extractBeforeH2Prefix(sourceText, "## Binding:");
    disciplinePackage.surface_source_hash = contentHash(disciplinePackage.surface_content);
    disciplinePackage.header = {
      package_id: yamlHeaderScalar(header, "package_id"),
      name: yamlHeaderScalar(header, "name"),
      version: yamlHeaderScalar(header, "version"),
      source_type: yamlHeaderScalar(header, "source_type"),
      discipline: yamlHeaderScalar(header, "discipline"),
      scope: yamlHeaderScalar(header, "scope"),
      status: yamlHeaderScalar(header, "status"),
      provenance: yamlHeaderScalar(header, "provenance"),
      surface_id: yamlHeaderScalar(header, "surface_id"),
      surface_install_path: yamlHeaderScalar(header, "surface_install_path"),
      retrieval_slices: yamlList(header, "retrieval_slices"),
      binding_ids: yamlList(header, "binding_ids")
    };
    disciplinePackage.bindings = bindingSections.map((bindingSection) => {
      const bindingHeader = parseFirstYamlFenceFromText(bindingSection.body);
      return {
        id: yamlHeaderScalar(bindingHeader, "id"),
        package_id: disciplinePackage.id,
        package_info_path: disciplinePackage.package_info_path,
        source_manifest: relativePath,
        source_path: sourcePath,
        source_hash: disciplinePackage.source_hash,
        source_anchor: bindingSection.heading,
        source_anchor_hash: contentHash(bindingSection.body.trim()),
        heading: bindingSection.heading.replace(/^Binding:\s*/, ""),
        source: disciplinePackage.source,
        body: promoteBindingHeadings(stripFirstYamlFence(bindingSection.body)),
        header: {
          id: yamlHeaderScalar(bindingHeader, "id"),
          name: yamlHeaderScalar(bindingHeader, "name"),
          version: yamlHeaderScalar(bindingHeader, "version"),
          status: yamlHeaderScalar(bindingHeader, "status"),
          install_path: yamlHeaderScalar(bindingHeader, "install_path"),
          discipline_sources: yamlObjectIds(bindingHeader, "discipline_sources"),
          required_slices: yamlNestedList(bindingHeader, "discipline_sources", "required_slices"),
          selection_triggers: yamlList(bindingHeader, "selection_triggers"),
          non_selection_rules: yamlList(bindingHeader, "non_selection_rules"),
          state_effects: yamlList(bindingHeader, "state_effects"),
          conflicts: yamlList(bindingHeader, "conflicts")
        },
        yaml: bindingHeader
      };
    });
  }

  return {
    package: packageInfo,
    installedSourcePages: parseObjectTable(section(text, "Installed Source Pages")),
    packages
  };
}

function parseDisciplineManifests(profile) {
  const coreManifest = parseDisciplineManifest("methodology/disciplines/package-manifest.md");
  const packageManifests = profile.disciplinePackageManifests.map((manifestPath) => parseDisciplineManifest(manifestPath));

  return {
    package: coreManifest.package,
    installedSourcePages: coreManifest.installedSourcePages,
    packages: [
      ...coreManifest.packages,
      ...packageManifests.flatMap((manifest) => manifest.packages)
    ]
  };
}

function withoutNone(items) {
  return items.filter((item) => item.toLowerCase() !== "none");
}

function parseNamedListInSurface(text, surfaceHeading, listHeading) {
  const surfaceBlock = h2Sections(text).find((item) => item.heading === surfaceHeading)?.body ?? "";
  return extractMarkdownList(surfaceBlock, listHeading, SURFACE_MANIFEST_FIELD_HEADINGS);
}

function parseNamedBlockInSurface(text, surfaceHeading, blockHeading) {
  const surfaceBlock = h2Sections(text).find((item) => item.heading === surfaceHeading)?.body ?? "";
  const lines = surfaceBlock.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${blockHeading}:`);
  if (start === -1) return "";

  const stopLabels = new Set(
    SURFACE_MANIFEST_FIELD_HEADINGS
      .filter((item) => item !== blockHeading)
      .map((item) => `${item}:`)
  );
  const block = [];

  for (const line of lines.slice(start + 1)) {
    if (stopLabels.has(line.trim())) break;
    block.push(line);
  }

  return block.join("\n").trim();
}

function parseStateModel() {
  const text = readText("methodology/states/state-model.md");
  const blocks = h2Sections(text).filter((item) => !["Purpose", "Page Contract"].includes(item.heading));

  return blocks.map(({ heading: title, body }) => {
    const id = body.match(/^id:\s*(.+)$/m)?.[1]?.trim();
    if (!id) throw new Error(`State ${title} is missing id.`);
    return {
      id,
      title,
      applies_when: parseStateList(body, "Applies when"),
      read_first: parseStateList(body, "Read first"),
      current_controller: parseStateList(body, "Current controller"),
      allowed_actions: parseStateList(body, "Allowed actions"),
      produce_or_update: parseStateList(body, "Produce or update"),
      transition_check: parseStateList(body, "Transition check"),
      failure_routes: parseStateList(body, "Failure routes"),
      stop_condition: parseStateList(body, "Stop condition")
    };
  });
}

function parseStateList(body, heading) {
  return extractMarkdownList(body, heading, [
    "Applies when",
    "Read first",
    "Current controller",
    "Allowed actions",
    "Produce or update",
    "Transition check",
    "Failure routes",
    "Stop condition"
  ]);
}

function extractMarkdownList(block, heading, stopHeadings) {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${heading}:`);
  if (start === -1) return [];

  const stopLabels = new Set(stopHeadings.filter((item) => item !== heading).map((item) => `${item}:`));
  const items = [];
  let current = null;

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (stopLabels.has(trimmed) || trimmed.startsWith("id:")) break;
    if (trimmed.length === 0) continue;

    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0 && trimmed.startsWith("- ")) {
      current = trimmed.slice(2).trim();
      items.push(current);
      continue;
    }

    if (current !== null) {
      current = `${current} ${trimmed}`;
      items[items.length - 1] = current;
    }
  }

  return items;
}

function assertUnique(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const value = item[key];
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function validateModel({ profile, core, processes, surfaces, states, discipline }) {
  assertUnique(processes.map((process) => process.package), "id", "process id");
  assertUnique(surfaces, "id", "semantic authority surface id");
  assertUnique(states, "id", "state id");
  assertUnique(discipline.allPackages, "id", "discipline package id");
  assertUnique(discipline.packages, "id", "discipline package id");
  assertUnique(discipline.surfaces, "id", "discipline content id");
  assertUnique(discipline.bindings, "id", "discipline binding id");

  if (profile.packageSelection.substrate !== core.package.id) {
    throw new Error(`Install profile selects missing substrate: ${profile.packageSelection.substrate}`);
  }

  const processIds = new Set(processes.map((process) => process.package.id));
  for (const selected of profile.processes) {
    if (!processIds.has(selected)) throw new Error(`Install profile selects missing process: ${selected}`);
  }

  const surfaceIds = new Set(surfaces.map((surface) => surface.id));
  for (const selected of profile.semanticAuthoritySurfaces) {
    if (!surfaceIds.has(selected)) throw new Error(`Install profile selects missing semantic authority surface: ${selected}`);
  }

  const disciplinePackageIds = new Set(discipline.allPackages.map((disciplinePackage) => disciplinePackage.id));
  for (const selected of profile.disciplinePackages) {
    if (!disciplinePackageIds.has(selected)) throw new Error(`Install profile selects missing discipline package: ${selected}`);
  }

  const stateIds = new Set(states.map((state) => state.id));
  for (const process of processes) {
    for (const state of process.states) {
      if (!stateIds.has(state)) throw new Error(`Process ${process.package.id} references missing state: ${state}`);
    }
  }

  const operationIds = new Set(core.semanticAuthorityOperations.map((operation) => operation.id));
  for (const process of processes) {
    for (const operation of process.semanticAuthorityOperations) {
      if (!operationIds.has(operation)) throw new Error(`Process ${process.package.id} references missing semantic authority operation: ${operation}`);
    }
  }

  const recordRoots = [];
  const storageLocators = [];
  for (const process of processes) {
    recordRoots.push({ id: process.package.id, record_root: process.package.record_root });
    storageLocators.push({ id: process.package.id, storage_locator: process.package.record_root });
    for (const record of process.records) {
      if (record.install_path.startsWith("records/")) {
        throw new Error(`Record contract ${process.package.id}:${record.id} installs under legacy records path: ${record.install_path}`);
      }
      if (!record.contract_source) {
        throw new Error(`Record contract ${process.package.id}:${record.id} is missing contract source.`);
      }
      recordRoots.push({ id: `${process.package.id}:${record.id}`, record_root: record.record_root });
      storageLocators.push({ id: `${process.package.id}:${record.id}`, storage_locator: record.record_root });
    }
  }
  for (const surface of surfaces) {
    if (!surface.storage_locator) throw new Error(`Surface ${surface.id} is missing storage locator.`);
    storageLocators.push({ id: surface.id, storage_locator: surface.storage_locator });
  }
  assertUnique(recordRoots, "record_root", "record root");
  assertUnique(storageLocators, "storage_locator", "storage locator");

  for (const surface of surfaces) {
    for (const field of ["owns", "updated_by", "retrieval_keys", "adequacy_checks", "promotion_candidates"]) {
      if (surface[field].length === 0) throw new Error(`Surface ${surface.id} is missing ${field}.`);
    }
    if (surface.body_shapes.length === 0) {
      throw new Error(`Surface ${surface.id} is missing body shapes.`);
    }
    if (REQUIRED_SURFACE_SEEDS.has(surface.id) && surface.minimal_seed_example.length === 0) {
      throw new Error(`Surface ${surface.id} is missing a minimal seed example.`);
    }
    for (const target of surface.backpressure_to) {
      if (!surfaceIds.has(target)) throw new Error(`Surface ${surface.id} has missing backpressure target: ${target}`);
    }
  }

  const selectedDisciplineSurfaceIds = new Set(discipline.surfaces.map((surface) => surface.id));
  const selectedDisciplineSurfaces = new Map(discipline.surfaces.map((surface) => [surface.id, surface]));
  for (const disciplinePackage of discipline.packages) {
    if (disciplinePackage.header.package_id !== disciplinePackage.id) {
      throw new Error(`Discipline package ${disciplinePackage.id} header package_id does not match manifest.`);
    }
    if (disciplinePackage.header.version !== disciplinePackage.version) {
      throw new Error(`Discipline package ${disciplinePackage.id} header version does not match manifest.`);
    }
    if (disciplinePackage.header.discipline !== disciplinePackage.discipline) {
      throw new Error(`Discipline package ${disciplinePackage.id} header discipline does not match manifest.`);
    }
    if (disciplinePackage.header.source_type !== disciplinePackage.source_type) {
      throw new Error(`Discipline package ${disciplinePackage.id} header source_type does not match manifest.`);
    }
    if (!disciplinePackage.header.surface_id) {
      throw new Error(`Discipline package ${disciplinePackage.id} is missing surface_id.`);
    }
    if (!disciplinePackage.header.surface_install_path) {
      throw new Error(`Discipline package ${disciplinePackage.id} is missing surface_install_path.`);
    }
    if (disciplinePackage.header.retrieval_slices.length === 0) {
      throw new Error(`Discipline package ${disciplinePackage.id} is missing retrieval slices.`);
    }
    if (disciplinePackage.bindings.length === 0) {
      throw new Error(`Discipline package ${disciplinePackage.id} has no bindings.`);
    }
    if (!sameSet(disciplinePackage.header.binding_ids, disciplinePackage.bindings.map((binding) => binding.id))) {
      throw new Error(`Discipline package ${disciplinePackage.id} binding_ids do not match package binding sections.`);
    }
  }
  for (const binding of discipline.bindings) {
    if (binding.header.id !== binding.id) throw new Error(`Discipline binding ${binding.id} header id is missing.`);
    if (!binding.header.version) throw new Error(`Discipline binding ${binding.id} header version is missing.`);
    if (!binding.header.install_path) throw new Error(`Discipline binding ${binding.id} header install_path is missing.`);
    if (binding.header.discipline_sources.length === 0) throw new Error(`Discipline binding ${binding.id} is missing discipline sources.`);
    if (binding.header.selection_triggers.length === 0) throw new Error(`Discipline binding ${binding.id} is missing selection triggers.`);
    if (binding.header.state_effects.length === 0) throw new Error(`Discipline binding ${binding.id} is missing state effects.`);
    if (binding.header.conflicts.length === 0) throw new Error(`Discipline binding ${binding.id} is missing conflict rules.`);
    for (const sourceId of binding.header.discipline_sources) {
      if (!selectedDisciplineSurfaceIds.has(sourceId)) {
        throw new Error(`Discipline binding ${binding.id} references unselected package surface content: ${sourceId}`);
      }
    }
    for (const requiredSlice of binding.header.required_slices) {
      const hasSlice = [...selectedDisciplineSurfaces.values()]
        .some((surface) => surface.header.retrieval_slices.includes(requiredSlice));
      if (!hasSlice) throw new Error(`Discipline binding ${binding.id} references missing retrieval slice: ${requiredSlice}`);
    }
  }

  for (const state of states) {
    for (const field of ["applies_when", "read_first", "current_controller", "allowed_actions", "produce_or_update", "transition_check", "failure_routes", "stop_condition"]) {
      if (state[field].length === 0) throw new Error(`State ${state.id} is missing ${field}.`);
    }
  }

  const sourceRefs = [
    ...core.installedSourcePages.map((item) => path.join(core.package.source_root, item.source)),
    ...core.checks.map((item) => path.join(core.package.source_root, item.source)),
    ...core.toolingContracts.map((item) => path.join(core.package.source_root, item.source)),
    ...core.semanticAuthorityOperations.map((item) => path.join(core.package.source_root, item.source)),
    ...core.semanticAuthorityChecks.map((item) => path.join(core.package.source_root, item.source)),
    ...core.responses.map((item) => path.join(core.package.source_root, item.source)),
    ...processes.flatMap((process) => process.installedSourcePages.map((item) => path.join(process.package.source_root, item.source))),
    ...processes.flatMap((process) => process.records.flatMap((item) => [
      path.join(process.package.source_root, item.source),
      path.join(process.package.source_root, item.contract_source)
    ])),
    ...surfaces.map((surface) => surface.contract),
    ...discipline.package.installedSourcePages.map((item) => path.join(discipline.package.package.source_root, item.source)),
    ...discipline.packages.map((disciplinePackage) => path.join(disciplinePackage.source_root, disciplinePackage.source))
  ];

  for (const ref of sourceRefs) {
    if (!fs.existsSync(path.join(repoRoot, ref))) throw new Error(`Manifest references missing source: ${ref}`);
  }
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function markdownIndentedList(items, indent = 2) {
  const pad = " ".repeat(indent);
  return items.map((item) => `${pad}- ${item}`).join("\n");
}

function markdownListOrFallback(items, fallback) {
  return items.length === 0 ? fallback : markdownList(items);
}

function renderStatePage(state) {
  return `# ${state.title}

## You Are Here When

${markdownList(state.applies_when)}

## Read First

${markdownList(state.read_first)}

## Current Controller

${markdownList(state.current_controller)}

## Allowed Actions

${markdownList(state.allowed_actions)}

## Produce Or Update

${markdownList(state.produce_or_update)}

## Transition Check

${markdownList(state.transition_check)}

## Failure Routes

${markdownList(state.failure_routes)}

## Stop Condition

${markdownList(state.stop_condition)}
`;
}

function renderRegistry({ processes, surfaces, states, core }) {
  const localSupportPages = core.installedSourcePages
    .map((item) => item.install_path)
    .filter((installPath) => installPath.startsWith("local-support/"));

  return `# Installed Methodology Registry

## Purpose

Use this generated page to find the installed methodology page that owns the
current question.

## Start

- start.md
- route.md

## States

${markdownList(states.map((state) => `states/${state.id}.md`))}

## Control Record Contracts

${markdownList(processes.flatMap((process) => process.records.map((record) => record.install_path)))}

## Process Pages

${markdownList(processes.flatMap((process) => process.installedSourcePages.map((item) => item.install_path)))}

## Local Support

${markdownList(localSupportPages)}

## Semantic Authority Operations

${markdownList(core.semanticAuthorityOperations.map((operation) => operation.install_path))}

## Semantic Authority Surfaces

${markdownList(surfaces.map((surface) => surface.install_path))}

## Discipline

- methodology guidance: disciplines/overview.md
- runtime catalog: ../disciplines/catalog.md
- runtime lock: ../disciplines/discipline.lock

## Checks

${markdownList(core.checks.map((check) => check.install_path))}

## Responses

${markdownList(core.responses.map((response) => response.install_path))}
`;
}

function renderDisciplineSurface(disciplinePackage) {
  return `# ${disciplinePackage.header.name}

\`\`\`yaml
id: ${disciplinePackage.header.surface_id}
package_id: ${disciplinePackage.id}
name: ${disciplinePackage.header.name}
version: ${disciplinePackage.version}
source: ${disciplinePackage.source_type}
discipline: ${disciplinePackage.discipline}
scope: ${disciplinePackage.header.scope}
status: ${disciplinePackage.header.status}
provenance: ${disciplinePackage.header.provenance}
package_info: ${disciplinePackage.package_info_path}
source_manifest: ${disciplinePackage.source_manifest}
source_path: ${disciplinePackage.source_path}
source_hash: ${disciplinePackage.source_hash}
surface_source_hash: ${disciplinePackage.surface_source_hash}
compatible_bindings:
${markdownIndentedList(disciplinePackage.bindings.map((binding) => binding.id))}
retrieval_slices:
${markdownIndentedList(disciplinePackage.header.retrieval_slices)}
\`\`\`

${disciplinePackage.surface_content}
`;
}

function renderDisciplineBinding(binding) {
  return `# ${binding.header.name}

\`\`\`yaml
${binding.yaml}
package_info: ${binding.package_info_path}
source_manifest: ${binding.source_manifest}
source_path: ${binding.source_path}
source_hash: ${binding.source_hash}
source_anchor: "${yamlScalar(binding.source_anchor)}"
source_anchor_hash: ${binding.source_anchor_hash}
\`\`\`

${binding.body}
`;
}

function renderDisciplinePackageInfo(disciplinePackage, outputs) {
  return `# ${disciplinePackage.header.name} Package Info

\`\`\`yaml
package_id: ${disciplinePackage.id}
package_version: ${disciplinePackage.version}
name: ${disciplinePackage.header.name}
source_type: ${disciplinePackage.source_type}
discipline: ${disciplinePackage.discipline}
scope: ${disciplinePackage.header.scope}
status: ${disciplinePackage.header.status}
provenance: ${disciplinePackage.header.provenance}
source_manifest: ${disciplinePackage.source_manifest}
source_path: ${disciplinePackage.source_path}
source_hash: ${disciplinePackage.source_hash}
package_info_path: ${disciplinePackage.package_info_path}
surface_id: ${disciplinePackage.header.surface_id}
surface_output: ${disciplinePackage.header.surface_install_path}
surface_source_hash: ${disciplinePackage.surface_source_hash}
surface_output_hash: ${outputs.surfaceHash}
binding_outputs:
${outputs.bindings.map(({ binding, hash }) => `  - id: ${binding.id}
    path: ${binding.header.install_path}
    source_anchor: "${yamlScalar(binding.source_anchor)}"
    source_anchor_hash: ${binding.source_anchor_hash}
    output_hash: ${hash}`).join("\n")}
retrieval_slices:
${markdownIndentedList(disciplinePackage.header.retrieval_slices)}
\`\`\`

## Meaning

This file is installed package info. It preserves selected package identity,
source location, source hash, generated output paths, and package-to-runtime
mapping.

It is not the full package source. It is not a discipline surface. Use
the generated surface and bindings for runtime work.
`;
}

function renderDisciplineCatalog({ packages }) {
  return `# Discipline Catalog

## Purpose

Use this installed catalog to discover discipline packages that may
materially apply to the current Lifecycle work.

Read this catalog before reading generated surface content. Select only
packages whose binding trigger summary fits the current Signal, target facts,
touched files, or risk shape.

## Installed Discipline Packages

${packages.map((disciplinePackage) => `### ${disciplinePackage.id}

- name: ${disciplinePackage.header.name}
- version: ${disciplinePackage.version}
- source type: ${disciplinePackage.source_type}
- discipline: ${disciplinePackage.discipline}
- scope: ${disciplinePackage.header.scope}
- status: ${disciplinePackage.header.status}
- package info path: ${disciplinePackage.package_info_path}
- source hash: ${disciplinePackage.source_hash}
- surface content path: ${disciplinePackage.header.surface_install_path}
- retrieval slices:
${markdownIndentedList(disciplinePackage.header.retrieval_slices)}
- bindings:
${markdownIndentedList(disciplinePackage.bindings.map((binding) => `${binding.id} -> ${binding.header.install_path}`))}
${disciplinePackage.bindings.map((binding) => `
#### ${binding.id}

- name: ${binding.header.name}
- version: ${binding.header.version}
- status: ${binding.header.status}
- local path: ${binding.header.install_path}
- discipline sources:
${markdownIndentedList(binding.header.discipline_sources)}
- required slices:
${markdownIndentedList(binding.header.required_slices)}
- selection triggers:
${markdownIndentedList(binding.header.selection_triggers)}
- non-selection rules:
${markdownIndentedList(binding.header.non_selection_rules)}
- state effects:
${markdownIndentedList(binding.header.state_effects)}
- conflicts:
${markdownIndentedList(binding.header.conflicts)}
`).join("\n")}
`).join("\n")}
`;
}

function renderDisciplineLock({ profile, discipline }) {
  const outputRoot = profile.output.discipline_root ?? ".lifecycle/disciplines";
  return `# Discipline Lock

profile: ${profile.packageSelection.id}
generated_by: setup/compile-install-helper.mjs

## Package

- id: ${discipline.package.package.id}
- version: ${discipline.package.package.version}
- source: ${discipline.package.package.source_root}

## Installed Package Info

${markdownList(discipline.packages.map((disciplinePackage) => `${disciplinePackage.id} ${disciplinePackage.version} ${disciplinePackage.source_hash} -> ${disciplinePackage.package_info_path}`))}

## Generated Surfaces

${markdownList(discipline.packages.map((disciplinePackage) => `${disciplinePackage.header.surface_id} -> ${disciplinePackage.header.surface_install_path}`))}

## Generated Bindings

${markdownList(discipline.bindings.map((binding) => `${binding.id} ${binding.header.version} from ${binding.source}`))}

## Output

- discipline root: ${outputRoot}

This lock is local install metadata. It is not product meaning or process state.
Control records preserve the discipline material that shaped a run.
`;
}

function renderSurfaceRegistry(surfaces) {
  const lines = ["semantic_authority_surfaces:"];
  for (const surface of surfaces) {
    lines.push(`  - id: "${yamlScalar(surface.id)}"`);
    lines.push(`    name: "${yamlScalar(surface.name)}"`);
    lines.push(`    storage_locator: "${yamlScalar(surface.storage_locator)}"`);
    lines.push(`    contract: "${yamlScalar(surface.install_path)}"`);
    lines.push(`    template: "${yamlScalar(surface.template)}"`);
    appendYamlList(lines, "owns", surface.owns, 4);
    appendYamlList(lines, "may_reference", surface.may_reference, 4);
    appendYamlList(lines, "backpressure_to", surface.backpressure_to, 4);
    appendYamlList(lines, "updated_by", surface.updated_by, 4);
    appendYamlList(lines, "retrieval_keys", surface.retrieval_keys, 4);
    appendYamlList(lines, "target_references", surface.target_references, 4);
    appendYamlList(lines, "adequacy_checks", surface.adequacy_checks, 4);
    appendYamlList(lines, "promotion_candidates", surface.promotion_candidates, 4);
  }
  return lines.join("\n");
}

function collectToolingContracts({ core, processes }) {
  const coreContracts = core.toolingContracts.map((item) => ({
    id: item.id,
    type: "core",
    source_path: path.posix.join(core.package.source_root, item.source),
    install_path: item.install_path
  }));
  const recordContracts = processes.flatMap((process) => process.records.map((record) => ({
    id: `control.${process.package.id}.${record.id}`,
    type: "control-record",
    process: process.package.id,
    record: record.id,
    record_root: record.record_root,
    source_path: path.posix.join(process.package.source_root, record.contract_source),
    install_path: path.posix.join("support", "control-records", process.package.id, `${record.id}.contract.json`)
  })));

  return [...coreContracts, ...recordContracts].map((contract) => {
    const sourceText = readText(contract.source_path);
    return {
      ...contract,
      source_hash: contentHash(sourceText)
    };
  });
}

function renderToolingContractRegistry(contracts) {
  return JSON.stringify({
    schema_version: "lifecycle.tooling.contract-registry.v1",
    generated_by: "setup/compile-install-helper.mjs",
    authority_boundary: "Generated tooling support is derived local support. Source methodology and source-owned contracts remain authoritative.",
    contracts: contracts.map((contract) => ({
      id: contract.id,
      type: contract.type,
      process: contract.process,
      record: contract.record,
      record_root: contract.record_root,
      source_path: contract.source_path,
      install_path: contract.install_path,
      source_hash: contract.source_hash
    }))
  }, null, 2);
}

function renderToolingLock({ profile, contracts, methodologyLockText, registryText }) {
  return JSON.stringify({
    schema_version: "lifecycle.tooling.lock.v1",
    generated_by: "setup/compile-install-helper.mjs",
    profile: profile.packageSelection.id,
    support_root: ".lifecycle/tooling",
    authority_boundary: "This lock is generated local support. It is not product authority or process history.",
    freshness_inputs: {
      methodology_lock_hash: contentHash(methodologyLockText),
      contract_registry_hash: contentHash(registryText),
      source_contract_hashes: contracts.map((contract) => ({
        id: contract.id,
        source_path: contract.source_path,
        source_hash: contract.source_hash
      }))
    }
  }, null, 2);
}

function installToolingSupport({ targetRoot, toolingRoot, profile, core, processes, methodologyLockText }) {
  const contracts = collectToolingContracts({ core, processes });
  const registryText = renderToolingContractRegistry(contracts);

  fs.rmSync(path.join(toolingRoot, "support"), { recursive: true, force: true });
  fs.mkdirSync(path.join(toolingRoot, "support"), { recursive: true });
  fs.mkdirSync(path.join(toolingRoot, "cache"), { recursive: true });
  fs.mkdirSync(path.join(toolingRoot, "findings"), { recursive: true });
  fs.mkdirSync(path.join(toolingRoot, "receipts"), { recursive: true });
  fs.mkdirSync(path.join(toolingRoot, "prepared-material"), { recursive: true });

  for (const contract of contracts) {
    copyFile(contract.source_path, path.join(toolingRoot, contract.install_path));
  }

  writeText(path.join(toolingRoot, "support", "contract-registry.json"), registryText);
  writeText(path.join(toolingRoot, "tooling.lock.json"), renderToolingLock({
    profile,
    contracts,
    methodologyLockText,
    registryText
  }));
  writeTextIfMissing(path.join(toolingRoot, "cache", "overview.md"), "# Tooling Cache\n\nThis folder stores rebuildable tooling indexes.\n");
  writeTextIfMissing(path.join(toolingRoot, "findings", "overview.md"), "# Tooling Findings\n\nThis folder stores current tool findings until an agent interprets them.\n");
  writeTextIfMissing(path.join(toolingRoot, "receipts", "overview.md"), "# Proof Receipts\n\nThis folder stores proof receipts produced by optional tooling.\n");
  writeTextIfMissing(path.join(toolingRoot, "prepared-material", "overview.md"), "# Prepared Material\n\nThis folder stores draft Evidence, Landing, and Closure material.\n");

  console.log(`Generated tooling support written to ${path.relative(repoRoot, toolingRoot)}`);
}

function yamlScalar(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function appendYamlList(lines, key, values, indent) {
  const pad = " ".repeat(indent);
  if (values.length === 0) {
    lines.push(`${pad}${key}: []`);
    return;
  }
  lines.push(`${pad}${key}:`);
  for (const value of values) lines.push(`${pad}  - "${yamlScalar(value)}"`);
}

function renderEntryTemplate(surface) {
  const idPlacement = surface.storage_locator.startsWith("records/")
    ? `stable product record ID under ${surface.storage_locator}`
    : `stable ${surface.name} entry ID in a colocated file matching \`${surface.storage_locator}\``;
  const contextAtlasFields = surface.id === "context"
    ? `context_area: ""
context_cluster: ""
context_role: ""
parent_context: ""
child_contexts: []
context_relations: []
`
    : "";
  const contextAtlasGuidance = surface.id === "context"
    ? `
## Context Atlas Fields

Use these fields when a Context entry belongs to a broad corpus or product
area. Leave them empty only when the Context set is small enough that an atlas
route would add no retrieval value.

These fields define the Context entry contract. Use the Clarity process for
broad source inventory, route review, content adequacy review,
canonicalization, promotion-pressure review, and retrieval proof.

- context_area: current product area or atlas area.
- context_cluster: current semantic neighborhood or subject cluster.
- context_role: area overview, cluster overview, canonical reference,
  rationale leaf, glossary, scenario, actor need, design reference, delivery
  constraint, implementation posture, proof context, open question, or topic
  leaf.
- parent_context: stable Context ID for the route or canonical entry this entry
  sits under, when applicable.
- child_contexts: stable Context IDs routed by this overview or canonical
  entry, when applicable.
- context_relations: local Context graph relation strings in
  \`relation:target\` form, such as \`parent:context.example\`,
  \`child:context.example\`, \`canonical_for:context.example\`,
  \`rationale_for:context.example\`, \`depends_on:context.example\`,
  \`tension_with:context.example\`, \`supersedes:context.example\`, or
  \`promotion_candidate_for:assurance\`.

For broad Context, use area overviews and semantic neighborhoods so future
agents can retrieve canonical references before rationale leaves. Use
promotion pressure when a Context entry points toward future Intent, Assurance,
Blueprint, or Description work. Treat \`state\` as product-authority state and
atlas review or freshness labels as limits on how strongly an entry may govern.
`
    : "";
  const seedExample = surface.minimal_seed_example.length > 0
    ? `
## Minimal Seed Example

Use this only as a shape example. Replace the IDs, scope, retrieval keys,
target references, related surfaces, and dates with the target repo's real
meaning.

${surface.minimal_seed_example}
`
    : "";
  const bodyShapes = surface.body_shapes.length > 0
    ? `
## Body Shape Guidance

Keep the YAML header standard for every ${surface.name} entry. Below the YAML
block, use the smallest body shape that makes the entry usable as future
authority. Delete irrelevant sections instead of filling them with placeholders.

${surface.body_shapes}
`
    : "";

  return `# ${surface.name} Entry Template

## Required Fields

~~~yaml
id: ""
surface: "${surface.id}"
state: "candidate"
scope: ""
${contextAtlasFields}current_meaning: ""
retrieval_keys: []
target_references: []
related_surfaces: []
supersedes: []
superseded_by: ""
updated_at: ""
~~~

## Field Use

- id: ${idPlacement}.
- state: one of candidate, admitted, current, provisional, stale, superseded,
  deprecated, or archived.
- scope: smallest product area, behavior, obligation, structure, or target
  surface this entry governs.
- current_meaning: durable product meaning owned by this surface.
- retrieval_keys: short finding keys future agents can use before reading
  product history.
- target_references: implementation surfaces only when they are part of this
  entry's owned meaning.
- related_surfaces: semantic authority entry IDs that must be considered with
  this entry.
- supersedes and superseded_by: stable IDs that control replacement.
- updated_at: date the entry meaning last changed.

## Provenance Boundary

Do not add Work Boundaries, product judgment, Evidence Packets, Landing
Packets, closure records, Discovery records, old source-material paths, proof
logs, tool findings, or runtime notes as authority fields in this entry.

Keep admission context, source material, proof, and migration or transfer
evidence in the owning Control record, archive decision, or source-material
workspace. This product entry should be usable as current authority without
opening those records.
${contextAtlasGuidance}
${bodyShapes}

## Owned Meaning

${markdownList(surface.owns)}

## Retrieval Keys

Use keys like:

${markdownList(surface.retrieval_keys)}

## Target References

${markdownListOrFallback(surface.target_references, "No target reference is required by default. Add target references only when implementation surfaces are part of the owned meaning.")}

## Surface Relationship Direction

May reference:

${markdownListOrFallback(surface.may_reference, "No may-reference surface is declared.")}

Backpressure to:

${markdownListOrFallback(surface.backpressure_to, "No earlier semantic authority surface is declared.")}

## Adequacy Checks

Before marking this entry current, confirm it:

${markdownList(surface.adequacy_checks)}

## Promotion Candidates

Promote learning into this surface when the learning is:

${markdownList(surface.promotion_candidates)}
${seedExample}
## Update Rule

Use this template only for durable product meaning owned by the ${surface.name}
semantic authority surface. Keep process state, proof logs, runtime notes, and
temporary reasoning out of this product entry.
`;
}

function renderLock({ profile, core, processes, surfaces, discipline }) {
  const localSupportRoot = path.posix.dirname(profile.output.scratch_root.replaceAll("\\", "/"));
  return `# Methodology Lock

profile: ${profile.packageSelection.id}
generated_by: setup/compile-install-helper.mjs

## Substrate

- id: ${core.package.id}
- version: ${core.package.version}
- source: ${core.package.source_root}

## Processes

${markdownList(processes.map((process) => `${process.package.id} ${process.package.version} from ${process.package.source_root}`))}

## Semantic Authority Surfaces

${markdownList(surfaces.map((surface) => `${surface.id} ${surface.storage_locator}`))}

## Discipline

${markdownList(discipline.packages.map((disciplinePackage) => `${disciplinePackage.id} ${disciplinePackage.version}`))}

## Output

- methodology root: ${profile.output.methodology_root}
- discipline root: ${profile.output.discipline_root ?? ".lifecycle/disciplines"}
- records root: ${profile.output.records_root}
- scratch root: ${profile.output.scratch_root}
- work traces root: ${path.posix.join(localSupportRoot, "work-traces")}
- stop-work requests root: ${path.posix.join(localSupportRoot, "stop-work-requests")}
`;
}

function recordOverviewText(folder, surface) {
  const recordPath = folder.length === 0 ? "records" : path.join("records", folder);

  if (folder.length === 0) {
    return `# Records

This folder stores committed Lifecycle records for this codebase.

Context, Intent, Assurance, and Blueprint semantic authority entries live in
their \`records/\` folders. Description semantic authority files live beside
described source files as \`_*.desc.md\`.
Persisted Control records live in control/.

Historical Control records may be retained in prior commits while current
\`records/control/\` is reset for a new process.
`;
  }

  if (folder === "control") {
    return `# Control Records

This folder stores persisted Control records for Lifecycle processes.

Use these records for the current Clarity, Discovery, or Delivery process state.
Processes own their Control records independently. After a closed process has
been committed for history, start the next process from a fresh Control-record
area and rely on semantic authority for durable product continuity.
`;
  }

  if (folder === "control/clarity") {
    return `# Clarity Control Records

This folder stores persisted Clarity Control records.

Use these records for the current Clarity process: Clarity Boundaries, Source
Inventories, Context Review Packets, and Clarity Closure Records.
`;
  }

  if (folder === "control/clarity/boundaries") {
    return `# Clarity Boundaries

This folder stores Clarity Boundaries.
`;
  }

  if (folder === "control/clarity/inventories") {
    return `# Source Inventories

This folder stores Clarity Source Inventories.
`;
  }

  if (folder === "control/clarity/reviews") {
    return `# Context Reviews

This folder stores Clarity Context Review Packets.
`;
  }

  if (folder === "control/clarity/closures") {
    return `# Clarity Closures

This folder stores Clarity Closure Records.
`;
  }

  if (folder === "control/discovery") {
    return `# Discovery Control Records

This folder stores persisted Discovery Control records.

Use these records for the current Discovery process: plans, plan maps, plan
items, and selection handoffs.
`;
  }

  if (folder === "control/discovery/maps") {
    return `# Discovery Plan Maps

This folder stores Discovery plan maps.
`;
  }

  if (folder === "control/discovery/plans") {
    return `# Discovery Plan Items

This folder stores Discovery plan items.
`;
  }

  if (folder === "control/discovery/selections") {
    return `# Discovery Selection Handoffs

This folder stores Discovery selection handoffs.
`;
  }

  if (folder === "control/delivery") {
    return `# Delivery Control Records

This folder stores persisted Delivery Control records.

Use these records for the current Delivery process: Work Boundaries, Evidence
Packets, Landing Packets, release summaries, knowledge promotion decisions,
archive decisions, and closure records.
`;
  }

  if (folder === "control/delivery/work-boundaries") {
    return `# Work Boundaries

This folder stores Delivery Work Boundaries.

Work Boundaries preserve product judgment and process-local Delivery scope.
They do not become durable product authority after closure.
`;
  }

  if (folder === "control/delivery/evidence") {
    return `# Evidence

This folder stores Evidence Packets and proof records.
`;
  }

  if (folder === "control/delivery/landings") {
    return `# Landings

This folder stores Landing Packets and release or merge handoffs.
`;
  }

  if (folder === "control/delivery/releases") {
    return `# Releases

This folder stores release summaries.
`;
  }

  if (folder === "control/delivery/promotions") {
    return `# Promotions

This folder stores knowledge promotion decisions.
`;
  }

  if (folder === "control/delivery/archives") {
    return `# Archives

This folder stores archive decisions.
`;
  }

  if (folder === "control/delivery/closures") {
    return `# Closures

This folder stores Delivery closure records.
`;
  }

  if (surface) {
    if (surface.id === "context") {
      return `# Context

This folder stores Context semantic authority entries for product meaning,
users, market, strategy, direction, and broad product-context atlas
organization.

Use .lifecycle/methodology/${surface.template} when creating an entry.
Retrieve entries by stable ID, state, scope, retrieval keys, target references,
related semantic authority, and Context atlas route when the corpus is broad.

Broad Context may be organized into product-area and cluster subfolders. Use
neutral overview.md files for folder purpose. Use current Context entries for
area overviews, canonical references, rationale leaves, semantic
neighborhoods, freshness policy, and promotion pressure.

When broad Context is reorganized, keep route review separate from leaf
content review; moving an entry into a better atlas path does not mark the
entry's owned meaning reviewed.

Use Clarity when broad Context maintenance, canonicalization, review-label
correction, promotion-pressure review, or retrieval repair is the work. Context
entries store product meaning; Clarity records store the review operation.

Owned meaning:

${markdownList(surface.owns)}

Do not store Control record state, product judgment, proof status, runtime
observations, tool findings, source-container provenance, or temporary
reasoning in this product-record folder.
`;
    }

    return `# ${surface.name}

This folder stores ${surface.name} semantic authority entries.

Use .lifecycle/methodology/${surface.template} when creating an entry.
Retrieve entries by stable ID, state, scope, retrieval keys, target references,
and related semantic authority.

Owned meaning:

${markdownList(surface.owns)}

Do not store Control record state, product judgment, proof status, runtime
observations, tool findings, or temporary reasoning in this product-record
folder.
`;
  }

  return `# Overview

This folder is part of the Lifecycle target-codebase layout.

Purpose: ${recordPath}

Do not invent product meaning, process state, proof, or decisions during setup.
`;
}

function scaffoldRecords(targetRoot, profile, processes, surfaces) {
  const recordsRoot = path.join(targetRoot, profile.output.records_root);
  const recordSurfaces = surfaces.filter((surface) => surface.storage_locator.startsWith("records/"));
  const surfacesByFolder = new Map(
    recordSurfaces.map((surface) => [surface.storage_locator.replace(/^records\//, ""), surface])
  );
  const folders = [
    "",
    "control",
    ...recordSurfaces.map((surface) => surface.storage_locator.replace(/^records\//, "")),
    ...processes.map((process) => process.package.record_root.replace(/^records\//, "")),
    ...processes.flatMap((process) => process.records.map((record) => record.record_root.replace(/^records\//, "")))
  ];

  for (const folder of [...new Set(folders)]) {
    const full = path.join(recordsRoot, folder);
    fs.mkdirSync(full, { recursive: true });
    writeTextIfMissing(path.join(full, "overview.md"), recordOverviewText(folder, surfacesByFolder.get(folder)));
  }
}

function compile(args) {
  const profile = parseProfile(args.profile);
  const core = parseCoreManifest();
  const disciplinePackageManifest = parseDisciplineManifests(profile);
  const processes = profile.processes.map((processId) =>
    parseProcessManifest(`methodology/processes/${processId}/package-manifest.md`)
  );
  const surfaces = parseSurfaceManifest().filter((surface) => profile.semanticAuthoritySurfaces.includes(surface.id));
  const states = parseStateModel();
  const selectedDisciplinePackages = disciplinePackageManifest.packages.filter((disciplinePackage) => profile.disciplinePackages.includes(disciplinePackage.id));
  const discipline = {
    package: disciplinePackageManifest,
    allPackages: disciplinePackageManifest.packages,
    packages: selectedDisciplinePackages,
    surfaces: selectedDisciplinePackages.map((disciplinePackage) => ({
      id: disciplinePackage.header.surface_id,
      package_id: disciplinePackage.id,
      install_path: disciplinePackage.header.surface_install_path,
      header: disciplinePackage.header
    })),
    bindings: selectedDisciplinePackages.flatMap((disciplinePackage) => disciplinePackage.bindings)
  };

  validateModel({ profile, core, processes, surfaces, states, discipline });

  const targetRoot = resolveTargetPath(args.target);
  const methodologyRoot = path.join(targetRoot, profile.output.methodology_root);
  const disciplineRoot = path.join(targetRoot, profile.output.discipline_root ?? ".lifecycle/disciplines");
  const scratchRoot = path.join(targetRoot, profile.output.scratch_root);
  const lifecycleRoot = path.dirname(scratchRoot);
  const workTraceRoot = path.join(lifecycleRoot, "work-traces");
  const stopWorkRequestRoot = path.join(lifecycleRoot, "stop-work-requests");
  const toolingRoot = path.join(lifecycleRoot, "tooling");
  const usageRoot = path.join(lifecycleRoot, "usage");

  if (args.cleanMethodology) {
    fs.rmSync(methodologyRoot, { recursive: true, force: true });
    fs.rmSync(disciplineRoot, { recursive: true, force: true });
    fs.rmSync(usageRoot, { recursive: true, force: true });
    if (!args.toolingSupport) {
      fs.rmSync(toolingRoot, { recursive: true, force: true });
    }
  }
  if (args.resetRecords) {
    fs.rmSync(path.join(targetRoot, profile.output.records_root), { recursive: true, force: true });
  } else if (args.startNewProcess) {
    fs.rmSync(path.join(targetRoot, profile.output.records_root, "control"), { recursive: true, force: true });
  }

  fs.mkdirSync(methodologyRoot, { recursive: true });
  fs.mkdirSync(disciplineRoot, { recursive: true });
  fs.mkdirSync(path.join(disciplineRoot, "package-info"), { recursive: true });
  fs.mkdirSync(path.join(disciplineRoot, "bindings"), { recursive: true });
  fs.mkdirSync(path.join(disciplineRoot, "surfaces"), { recursive: true });
  fs.mkdirSync(path.join(disciplineRoot, "cache"), { recursive: true });
  fs.mkdirSync(scratchRoot, { recursive: true });
  fs.mkdirSync(workTraceRoot, { recursive: true });
  fs.mkdirSync(stopWorkRequestRoot, { recursive: true });
  ensureLine(path.join(targetRoot, ".gitignore"), ".lifecycle/");
  writeTextIfMissing(path.join(scratchRoot, "overview.md"), "# Scratch\n\nThis folder holds local temporary Lifecycle reasoning and work support.\n");
  writeTextIfMissing(path.join(workTraceRoot, "overview.md"), "# Work Traces\n\nThis folder stores optional gitignored work traces for active runs.\n");
  writeTextIfMissing(path.join(stopWorkRequestRoot, "overview.md"), "# Stop-Work Requests\n\nThis folder stores local stop-work requests for active runs.\n");

  for (const item of core.installedSourcePages.filter((item) => item.id !== "registry")) {
    copyFile(path.join(core.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  }
  for (const item of core.checks) copyFile(path.join(core.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  for (const item of core.semanticAuthorityOperations) copyFile(path.join(core.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  for (const item of core.semanticAuthorityChecks) copyFile(path.join(core.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  for (const item of core.responses) copyFile(path.join(core.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  for (const item of discipline.package.installedSourcePages) {
    copyFile(path.join(discipline.package.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
  }

  for (const process of processes) {
    for (const item of process.installedSourcePages) {
      copyFile(path.join(process.package.source_root, item.source), path.join(methodologyRoot, item.install_path));
    }
  }

  for (const state of states) {
    writeText(path.join(methodologyRoot, "states", `${state.id}.md`), renderStatePage(state));
  }

  for (const process of processes) {
    for (const record of process.records) {
      copyProcessRecordReference(process.package.id, path.join(process.package.source_root, record.source), path.join(methodologyRoot, record.install_path));
    }
  }

  for (const surface of surfaces) {
    copyFile(surface.contract, path.join(methodologyRoot, surface.install_path));
    writeText(path.join(methodologyRoot, surface.template), renderEntryTemplate(surface));
  }

  for (const disciplinePackage of discipline.packages) {
    const surfaceOutput = renderDisciplineSurface(disciplinePackage);
    const bindingOutputs = disciplinePackage.bindings.map((binding) => ({
      binding,
      text: renderDisciplineBinding(binding)
    }));
    writeText(path.join(disciplineRoot, disciplinePackage.package_info_path), renderDisciplinePackageInfo(disciplinePackage, {
      surfaceHash: contentHash(surfaceOutput),
      bindings: bindingOutputs.map(({ binding, text }) => ({ binding, hash: contentHash(text) }))
    }));
    writeText(path.join(disciplineRoot, disciplinePackage.header.surface_install_path), surfaceOutput);
    for (const { binding, text } of bindingOutputs) {
      writeText(path.join(disciplineRoot, binding.header.install_path), text);
    }
  }
  writeText(path.join(disciplineRoot, "catalog.md"), renderDisciplineCatalog(discipline));
  writeText(path.join(disciplineRoot, "discipline.lock"), renderDisciplineLock({ profile, discipline }));

  writeText(path.join(methodologyRoot, "registry.md"), renderRegistry({ processes, surfaces, states, core }));
  writeText(path.join(methodologyRoot, "semantic-authority", "semantic-authority-surface-registry.yaml"), renderSurfaceRegistry(surfaces));
  const methodologyLockText = renderLock({ profile, core, processes, surfaces, discipline });
  writeText(path.join(targetRoot, profile.output.lock_file), methodologyLockText);

  if (args.toolingSupport) {
    installToolingSupport({
      targetRoot,
      toolingRoot,
      profile,
      core,
      processes,
      methodologyLockText
    });
  }

  scaffoldRecords(targetRoot, profile, processes, surfaces);

  // Usage docs live at tools/usage in the development repo (owner layout) and
  // at usage/tools in the published release (reader layout); the same helper
  // ships in both, so it accepts either source.
  const usageSourceCandidates = [
    path.join(repoRoot, "tools", "usage"),
    path.join(repoRoot, "usage", "tools")
  ];
  const toolsUsageSource = usageSourceCandidates.find((candidate) => fs.existsSync(candidate));
  if (!toolsUsageSource) {
    throw new Error("Missing tool usage docs: expected tools/usage or usage/tools in the source repo");
  }
  const usageToolsRoot = path.join(usageRoot, "tools");
  fs.mkdirSync(usageToolsRoot, { recursive: true });
  writeTextIfMissing(path.join(usageRoot, "overview.md"), "# Usage\n\nThis folder holds installed operating docs that travel alongside the methodology.\nEach subfolder owns one topic; tools/ covers the optional lt CLI.\n");
  for (const entry of fs.readdirSync(toolsUsageSource)) {
    if (!entry.endsWith(".md")) continue;
    fs.copyFileSync(path.join(toolsUsageSource, entry), path.join(usageToolsRoot, entry));
  }

  console.log(`Installed methodology written to ${path.relative(repoRoot, methodologyRoot)}`);
  console.log(`Installed usage docs written to ${path.relative(repoRoot, usageToolsRoot)}`);
  console.log(`Installed disciplines written to ${path.relative(repoRoot, disciplineRoot)}`);
  console.log(`Methodology lock written to ${path.relative(repoRoot, path.join(targetRoot, profile.output.lock_file))}`);
  if (args.startNewProcess && !args.resetRecords) {
    console.log(`Control records reset for a new process at ${path.relative(repoRoot, path.join(targetRoot, profile.output.records_root, "control"))}`);
  }
}

try {
  compile(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
