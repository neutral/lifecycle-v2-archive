import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dispatchFoundationDraftCli, renderFoundationDraftCli } from "../../src/foundation/draft/cli.js";
import { readFoundationLocalDraftFile } from "../../src/foundation/draft/local-reader.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE, FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE, renderAgentWorkProductTemplate } from "../../src/foundation/control/agent-work-product-semantics.js";
import { FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE } from "../../src/foundation/check/environment-requirements.js";

test("draft form discovery enters no target and renders the existing role form", async () => {
  const catalogue = await dispatchFoundationDraftCli(["forms"]);
  assert.deepEqual(catalogue.value.forms, ["knowledge", "reconnaissance", "builder", "reviewer"]);
  for (const role of ["reconnaissance", "builder", "reviewer"] as const) {
    const form = await dispatchFoundationDraftCli(["forms", role]);
    assert.equal(form.exitCode, 0);
    assert.match(renderFoundationDraftCli(form), /Work Product/u);
    assert.equal(form.value.authority, "installed-authoring-format");
    assert.equal(form.value.markdown, renderAgentWorkProductTemplate(role).markdown, "Guidance does not alter the selected semantic template");
    assert(renderFoundationDraftCli(form).includes(FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE));
    assert.equal(renderFoundationDraftCli(form).includes(FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE), role === "reconnaissance");
    assert.equal(renderFoundationDraftCli(form).includes(FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE), role === "reviewer");
    if (role === "reviewer") {
      assert.match(renderFoundationDraftCli(form), /requires-readmission requires exactly one Material Condition block/u);
      assert.match(renderFoundationDraftCli(form), /must cite its own exact original Receipt/u);
      assert.match(renderFoundationDraftCli(form), /not the Work Boundary record identity or a new local handle/u);
      assert.match(renderFoundationDraftCli(form), /Subject uses the supplied frozen citation handle and Supports names at least one Claim local handle/u);
      assert.match(renderFoundationDraftCli(form), /A Claim with Category limitation is still a Claim and cannot satisfy that reference/u);
    }
    if (role === "reconnaissance") {
      assert.match(renderFoundationDraftCli(form), /Environment requirement is optional/u);
      assert.match(renderFoundationDraftCli(form), /Preserve genuine additional requirements and request a supported selection or a Director decision to change the mandate/u);
      assert.match(renderFoundationDraftCli(form), /Semantic draft validity does not establish Check execution feasibility/u);
    }
  }
  await assert.rejects(dispatchFoundationDraftCli(["forms", "builder", "--basis", "/private/not-selected"]), { code: "cli.usage" });
  await assert.rejects(dispatchFoundationDraftCli(["semantic", ".", "semantic.md", "--basis", "relative.json"]), { code: "cli.usage" });
});

test("draft local reads observe explicit unstaged bytes and refuse unsafe selections without editing", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-draft-read-"));
  try {
    await mkdir(join(root, "work"));
    await writeFile(join(root, "work", "draft.md"), "local draft\n", { mode: 0o644 });
    const file = await readFoundationLocalDraftFile({ root, path: "work/draft.md", maximumBytes: 12 });
    assert.equal(file.sourceDigest, sha256Bytes("local draft\n"));
    assert.equal(file.bytes.toString(), "local draft\n");
    assert.equal(await readFile(join(root, "work", "draft.md"), "utf8"), "local draft\n");
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "../outside", maximumBytes: 12 }), { code: "lifecycle.path.invalid" });
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "work/draft.md", maximumBytes: 2 }), { code: "lifecycle.draft.file-bound" });
    await symlink(join(root, "work", "draft.md"), join(root, "linked.md"));
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "linked.md", maximumBytes: 12 }), { code: "lifecycle.draft.file-mode" });
    await symlink(join(root, "work"), join(root, "redirect"));
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "redirect/draft.md", maximumBytes: 12 }), { code: "lifecycle.draft.path" });
    await chmod(join(root, "work", "draft.md"), 0o755);
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "work/draft.md", maximumBytes: 12 }), { code: "lifecycle.draft.file-mode" });
    await chmod(join(root, "work", "draft.md"), 0o644);
    await link(join(root, "work", "draft.md"), join(root, "hardlink.md"));
    await assert.rejects(readFoundationLocalDraftFile({ root, path: "hardlink.md", maximumBytes: 12 }), { code: "lifecycle.draft.file-mode" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
