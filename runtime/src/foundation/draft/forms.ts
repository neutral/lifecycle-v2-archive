import { FoundationError } from "../error.js";
import { FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE } from "../check/environment-requirements.js";
import { FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE, FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE, renderAgentWorkProductTemplate, type AgentWorkProductRole } from "../control/agent-work-product-semantics.js";
import { FOUNDATION_KNOWLEDGE_BODY_SECTIONS } from "../knowledge/records.js";
import { FOUNDATION_GENERATED_SCHEMAS, FOUNDATION_GENERATED_SCHEMA_SET_DIGEST } from "../validation/generated-schemas.js";
import { FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID } from "../validation/schema-engine.js";
import { FOUNDATION_LOCAL_DRAFT_PROFILE } from "./limits.js";

export const FOUNDATION_DRAFT_FORMS = Object.freeze(["knowledge", "reconnaissance", "builder", "reviewer"] as const);

export function inspectFoundationDraftForm(form: string | undefined) {
  if (form === undefined) return Object.freeze({
    kind: "draft-forms" as const,
    profile: FOUNDATION_LOCAL_DRAFT_PROFILE,
    authority: "installed-authoring-format" as const,
    forms: FOUNDATION_DRAFT_FORMS,
    next: "Use lifecycle draft forms FORM to inspect its installed format. Discovery does not make an operation eligible or create an edit capability.",
  });
  if (!FOUNDATION_DRAFT_FORMS.includes(form as typeof FOUNDATION_DRAFT_FORMS[number])) {
    throw new FoundationError("cli.usage", `Unsupported draft form; choose ${FOUNDATION_DRAFT_FORMS.join(", ")}`);
  }
  if (form === "knowledge") {
    const schema = FOUNDATION_GENERATED_SCHEMAS.find(({ id }) => id === FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID);
    if (schema === undefined) throw new FoundationError("lifecycle.draft.schema-unavailable", "Installed Knowledge schema is unavailable");
    return Object.freeze({
      kind: "knowledge-form" as const,
      profile: FOUNDATION_LOCAL_DRAFT_PROFILE,
      authority: "installed-authoring-format" as const,
      schemaId: FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID,
      schemaSetDigest: FOUNDATION_GENERATED_SCHEMA_SET_DIGEST,
      frontMatterSchema: schema.schema,
      body: { title: "One level-one heading equal to the front-matter title", requiredLevelTwoSectionsByKind: FOUNDATION_KNOWLEDGE_BODY_SECTIONS },
      next: "Inspect selected local files with lifecycle draft knowledge WORKSPACE PATH...; include each complete local revision chain. This format does not grant permission to change a record.",
    });
  }
  return Object.freeze({
    kind: "semantic-form" as const,
    profile: FOUNDATION_LOCAL_DRAFT_PROFILE,
    authority: "installed-authoring-format" as const,
    ...renderAgentWorkProductTemplate(form as AgentWorkProductRole),
    next: [
      FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE,
      ...(form === "reviewer" ? [FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE] : []),
      ...(form === "reconnaissance" ? [FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE] : []),
      "Use the exact template and immutable basis selected by your Attempt. An installed form alone does not establish that it matches retained inputs or make a draft acceptable.",
    ].join("\n\n"),
  });
}
