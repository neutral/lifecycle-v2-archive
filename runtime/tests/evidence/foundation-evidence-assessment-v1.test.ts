import assert from "node:assert/strict";
import test from "node:test";
import { assessFoundationEvidenceV1, type FoundationEvidenceAssessmentInputV1, type FoundationEvidenceCheckFactsV1 } from "../../src/foundation/evidence/assessment-v1.js";
import { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "../../src/foundation/evidence/coordinates-v7.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

// Direct semantic domain fixture: no Delivery, Control revision, Journal, Activity,
// frozen Condition, currentness or Director subject is needed to ask what facts establish.
function facts(): FoundationEvidenceAssessmentInputV1 {
  const ref = (kind:string,id:string) => ({kind,id,revision:1,digest:sha256Bytes(id)});
  const subject = {boundary:ref("work-boundary","w"),candidate:ref("candidate-revision","c"),seal:ref("candidate-seal","s"),integration:ref("integration-assessment","a"),parent:{commit:"1".repeat(40),tree:"2".repeat(40),snapshotDigest:sha256Bytes("parent")}};
  const definition = {id:"check.unit",revision:1,sourceDigest:sha256Bytes("source"),semanticDigest:sha256Bytes("meaning")};
  const binding = {id:"binding.unit",digest:sha256Bytes("binding"),implementationDigest:sha256Bytes("implementation")};
  const receipt = ref("check-receipt","receipt.final");
  return {
    subject, observationSubject:subject,
    requirements:{
      checks:[{id:"check.selected",definition,bindings:[binding],modality:"postcondition",baselineRequired:false,finalRequired:true,
        obligationIds:["obligation.product"],environmentRequirements:[]}],
      obligations:[{id:"obligation.product",severity:"required",requiredEvidenceArtifactIds:["artifact.product"],propositionIds:["proposition.product"]}],
      artifacts:[{id:"artifact.product",path:"src/product.ts",mustChange:true,obligationIds:["obligation.product"]}],
      propositions:[{id:"proposition.product",obligationIds:["obligation.product"],allowNotApplicable:false,notApplicableCondition:null}],
    },
    checks:[{reference:receipt,proofSubject:subject.seal,phase:"final",modality:"postcondition",disposition:"pass",selectionId:"check.selected",
      allocation:"allocated",notRunAuthorization:null,startedAt:"2026-09-05T09:59:59.000Z",
      finishedAt:"2026-09-05T10:00:00.000Z",definition,binding,requestedConditions:[]}],
    review:{reference:ref("agent-work-product","review"),subject,
      citations:[{id:"citation.receipt",subjectId:receipt.id,subjectDigest:receipt.digest,subjectKind:"evidence"}],
      mandateApplicability:{disposition:"applicable",citationIds:["citation.receipt"],rationale:"Exact parent and result preserve this requirement.",fragmentDigest:sha256Bytes("applicability")},
      baselineApplicability:[],
      judgments:[{id:"judgment.product",propositionId:"proposition.product",disposition:"accepted",citationIds:["citation.receipt"],
        inspectedSubjectIds:[receipt.id],uncertainty:"none",limitationIds:[],fragmentDigest:sha256Bytes("judgment")}],
      mandateExcess:false,missingObligationIds:[],overallUncertainty:"none",
    },
    independence:{contextSeparation:"distinct"},
    observation:{evaluatedAt:"2026-09-05T10:00:01.000Z",ruleSet:FOUNDATION_EVIDENCE_RULE_SET_V7,validator:FOUNDATION_EVIDENCE_VALIDATOR_V7,
      reviewerSubjectDisposition:"exact-read-only",
      artifacts:[{artifactId:"artifact.product",fileKind:"file",existence:"present",change:"modified",contentDigest:sha256Bytes("bytes"),manifestDigest:null,
        schemaValidation:"not-required",semanticValidation:"valid"}],
      descriptionCoverage:[{path:"src/product.ts",descriptionId:"description.product",selector:"src/**",ownership:"exact",implementationChange:"changed",
        descriptionChange:"unchanged",exclusionChange:"none",obligationIds:["obligation.product"]}],
    },
  };
}

test("semantic assessment establishes support directly from exact facts without a workflow", () => {
  const input = facts();
  assert.deepEqual(Object.keys(input).sort(), ["checks","independence","observation","observationSubject","requirements","review","subject"]);
  const result = assessFoundationEvidenceV1(input);
  assert.equal(result.disposition,"supported");
  assert.equal(result.requiresMandateResolution,false);
  assert.equal(result.artifacts[0]!.state,"satisfied");
  assert.equal(result.descriptions[0]!.state,"satisfied");
  assert.equal(result.obligations[0]!.state,"satisfied");
  assert.deepEqual(Object.keys(result.independence[0]!).sort(),
    ["contextSeparation","id","ruleId","state","subjectDisposition"]);
});

test("semantic diagnosis precedes every required mandate response", () => {
  const input = facts();
  for (const review of [
    {...input.review,mandateApplicability:{...input.review.mandateApplicability,disposition:"requires-readmission" as const}},
    {...input.review,mandateExcess:true},
    {...input.review,missingObligationIds:["obligation.product"]},
    {...input.review,overallUncertainty:"material" as const},
    {...input.review,judgments:input.review.judgments.map((entry) => ({...entry,uncertainty:"material" as const}))},
  ]) {
    const result = assessFoundationEvidenceV1({...input,review});
    assert.equal(result.disposition,"mandate-resolution-required");
    assert.equal(result.requiresMandateResolution,true);
  }
});

test("raw physical contradictions cannot be overridden by supplied satisfaction claims", () => {
  const input = facts();
  for (const mutation of [
    {schemaValidation:"invalid" as const}, {semanticValidation:"invalid" as const}, {change:"unchanged" as const}, {contentDigest:null},
  ]) {
    const result = assessFoundationEvidenceV1({...input,observation:{...input.observation,
      artifacts:input.observation.artifacts.map((entry) => ({...entry,...mutation,state:"satisfied"}))}});
    assert.equal(result.artifacts[0]!.state,"failed");
    assert.equal(result.disposition,"unmet");
  }
  for (const mutation of [{ownership:"missing" as const},{descriptionId:null},{selector:null},{descriptionChange:"absent" as const}]) {
    const result = assessFoundationEvidenceV1({...input,observation:{...input.observation,
      descriptionCoverage:input.observation.descriptionCoverage.map((entry) => ({...entry,...mutation,state:"satisfied"}))}});
    assert.equal(result.descriptions[0]!.state,"failed");
    assert.equal(result.disposition,"unmet");
  }
});

test("semantic proof rejects exact-subject, selected-check and citation substitution", () => {
  const input = facts();
  const wrongSeal = {...input.subject.seal,digest:sha256Bytes("other seal")};
  const mutations: FoundationEvidenceAssessmentInputV1[] = [
    {...input,observationSubject:{...input.observationSubject,seal:wrongSeal}},
    {...input,review:{...input.review,subject:{...input.subject,parent:{...input.subject.parent,commit:"3".repeat(40)}}}},
    {...input,review:{...input.review,subject:{...input.subject,integration:{...input.subject.integration,digest:sha256Bytes("other assessment")}}}},
    {...input,review:{...input.review,subject:{...input.subject,seal:wrongSeal}}},
    {...input,checks:input.checks.map((entry) => ({...entry,proofSubject:wrongSeal}))},
    {...input,checks:input.checks.map((entry) => ({...entry,definition:{...entry.definition,semanticDigest:sha256Bytes("other check")}}))},
    {...input,checks:input.checks.map((entry) => ({...entry,binding:{...entry.binding,digest:sha256Bytes("other binding")}}))},
    {...input,review:{...input.review,citations:[]}},
    {...input,review:{...input.review,judgments:input.review.judgments.map((entry) => ({...entry,inspectedSubjectIds:["other subject"]}))}},
  ];
  for (const mutant of mutations) assert.throws(() => assessFoundationEvidenceV1(mutant));
  for (const subject of [
    {...input.subject,parent:{...input.subject.parent,commit:"4".repeat(40)}},
    {...input.subject,integration:{...input.subject.integration,digest:sha256Bytes("paired replacement assessment")}},
  ]) {
    assert.throws(() => assessFoundationEvidenceV1({...input,subject,review:{...input.review,subject}}),
      /Physical Evidence facts select another exact integration comparison basis/u);
  }
});

test("failed, absent, stale, uncertain or non-independent proof remains visible", () => {
  const input = facts();
  for (const mutant of [
    {...input,checks:[]},
    {...input,checks:input.checks.map((entry) => ({...entry,disposition:"fail" as const}))},
    {...input,checks:input.checks.map((entry) => ({...entry,finishedAt:"2026-09-05T10:00:02.000Z"}))},
    {...input,review:{...input.review,overallUncertainty:"unknown" as const}},
    {...input,independence:{contextSeparation:"shared" as const}},
    {...input,independence:{contextSeparation:"unobserved" as const}},
    {...input,observation:{...input.observation,reviewerSubjectDisposition:"mutated" as const}},
  ]) assert.notEqual(assessFoundationEvidenceV1(mutant).disposition,"supported");
  const suppliedVerdict = {...input,independence:{contextSeparation:"unobserved" as const,state:"satisfied",providerSession:"fresh"}};
  assert.notEqual(assessFoundationEvidenceV1(suppliedVerdict).disposition,"supported");
});

test("an admitted repair baseline may fail and its integration applicability is a separate semantic judgment", () => {
  const input = facts();
  const original = input.checks[0]!;
  const baseline = {...original,reference:{...original.reference,id:"receipt.baseline",digest:sha256Bytes("baseline")},
    proofSubject:input.subject.boundary,phase:"baseline" as const,modality:"repair-target" as const,disposition:"fail" as const};
  const repaired: FoundationEvidenceAssessmentInputV1 = {...input,
    requirements:{...input.requirements,checks:input.requirements.checks.map((entry) => ({...entry,modality:"repair-target",baselineRequired:true}))},
    checks:[baseline,{...original,modality:"repair-target"}],
    review:{...input.review,citations:[...input.review.citations,{id:"citation.baseline",subjectId:baseline.reference.id,subjectDigest:baseline.reference.digest,subjectKind:"evidence"}],
      baselineApplicability:[{receiptId:baseline.reference.id,disposition:"applicable",citationIds:["citation.baseline"],rationale:"The original failure is the exact repair target at the selected parent.",fragmentDigest:sha256Bytes("baseline-applicability")}]},
  };
  assert.equal(assessFoundationEvidenceV1(repaired).disposition,"supported");
  const result = assessFoundationEvidenceV1({...repaired,review:{...repaired.review,
    baselineApplicability:repaired.review.baselineApplicability.map((entry) => ({...entry,disposition:"insufficient"}))}});
  assert.equal(result.disposition,"mandate-resolution-required");
  assert.equal(result.requiresMandateResolution,true);
});

test("authorized baseline postcondition non-execution supports final proof without an execution age", () => {
  const input = facts();
  const final = input.checks[0]!;
  const baseline = {...final,reference:{...final.reference,id:"receipt.baseline",digest:sha256Bytes("authorized baseline")},
    proofSubject:input.subject.boundary,phase:"baseline" as const,disposition:"not-run" as const,
    allocation:"not-allocated" as const,notRunAuthorization:"baseline-postcondition" as const,startedAt:null,finishedAt:null};
  const exact: FoundationEvidenceAssessmentInputV1 = {...input,
    requirements:{...input.requirements,checks:input.requirements.checks.map(entry => ({...entry,baselineRequired:true}))},
    checks:[baseline,final],
    review:{...input.review,citations:[...input.review.citations,{id:"citation.baseline",subjectId:baseline.reference.id,
      subjectDigest:baseline.reference.digest,subjectKind:"evidence"}],
    baselineApplicability:[{receiptId:baseline.reference.id,disposition:"applicable",citationIds:["citation.baseline"],
      rationale:"The exact baseline postcondition remains authorized not to run; the final Receipt supplies execution proof.",
      fragmentDigest:sha256Bytes("postcondition applicability")}]},
  };
  const result = assessFoundationEvidenceV1(exact);
  assert.equal(result.disposition,"supported");
  assert.equal(result.uncertainty.level,"none");
  assert.equal(result.obligations[0]!.state,"satisfied");
  assert((result.obligations[0]!.receiptIds as readonly string[]).includes(baseline.reference.id));
  const entry = result.receiptUse.find(value => value.phase === "baseline")!;
  assert.deepEqual({...entry,id:undefined}, {id:undefined,checkId:"check.selected",phase:"baseline",receiptId:baseline.reference.id,
    use:"excluded",freshness:"not-applicable",subjectEquivalence:"exact",ageMs:null,maximumAgeMs:null,
    reasonCode:"baseline-postcondition-not-run",provenance:"runtime-derived"});
  const finalEntry = result.receiptUse.find(value => value.phase === "final")!;
  assert.equal(finalEntry.use,"executed"); assert.equal(finalEntry.freshness,"fresh"); assert.equal(finalEntry.ageMs,1000);

  // Finite semantic mutations: the exemption belongs only to the exact
  // authorized unallocated baseline. It cannot excuse missing or failed proof.
  const invalidBaselines: FoundationEvidenceCheckFactsV1[] = [
    {...baseline,notRunAuthorization:null},
    {...baseline,notRunAuthorization:"upstream-condition"},
    {...baseline,allocation:"allocated"},
    {...baseline,startedAt:final.startedAt},
    {...baseline,finishedAt:final.finishedAt},
    {...baseline,startedAt:final.startedAt,finishedAt:final.finishedAt},
    {...baseline,disposition:"unsupported"},
    {...baseline,disposition:"fail"},
  ];
  for (const changed of invalidBaselines) assert.notEqual(assessFoundationEvidenceV1({...exact,checks:[changed,final]}).disposition,"supported");
  assert.throws(() => assessFoundationEvidenceV1({...exact,checks:[final]}),
    /Baseline applicability must cite its exact original Receipt/u);
  for (const changed of [{...final,finishedAt:null}, {...final,disposition:"fail" as const},
    {...final,disposition:"not-run" as const,allocation:"not-allocated" as const,notRunAuthorization:"baseline-postcondition" as const,startedAt:null,finishedAt:null}]) {
    assert.notEqual(assessFoundationEvidenceV1({...exact,checks:[baseline,changed]}).disposition,"supported");
  }
  for (const modality of ["precondition","repair-target","regression-guard","diagnostic"] as const) {
    assert.notEqual(assessFoundationEvidenceV1({...exact,
      requirements:{...exact.requirements,checks:exact.requirements.checks.map(value => ({...value,modality}))},
      checks:[{...baseline,modality},{...final,modality}]}).disposition,"supported");
  }
  for (const changed of [
    {...baseline,proofSubject:input.subject.seal},
    {...baseline,definition:{...baseline.definition,semanticDigest:sha256Bytes("different baseline definition")}},
    {...baseline,binding:{...baseline.binding,digest:sha256Bytes("different baseline binding")}},
    {...baseline,requestedConditions:["another condition"]},
  ]) assert.throws(() => assessFoundationEvidenceV1({...exact,checks:[changed,final]}));
  assert.throws(() => assessFoundationEvidenceV1({...exact,review:{...exact.review,baselineApplicability:[]}}));
});
