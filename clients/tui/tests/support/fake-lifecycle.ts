import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FOUNDATION_RUNTIME_VERSION_EXPECTATION } from "@neutral/lifecycle-protocol";
import {
  testAttemptViewResult,
  testControlRevision,
  testDeliveryViewResult,
  testDigest,
  testInboxResult,
  testPrepareResult,
  testStatusResult,
} from "./protocol-v10.js";

export const FOUNDATION_TUI_TEST_VERSION = Object.freeze({
  ...FOUNDATION_RUNTIME_VERSION_EXPECTATION,
  publicationDigest: testDigest("f"),
  provider: Object.freeze({
    ...FOUNDATION_RUNTIME_VERSION_EXPECTATION.provider,
    defaultDescriptorDigest: testDigest("e"),
  }),
});
export type FakeLifecycleEnvironment = Readonly<{
  machineHome: string | null;
  codexPath: string | null;
  model: string | null;
  reasoning: string | null;
  execution: Readonly<{
    dockerPath: string | null;
    dockerHost: string | null;
    dockerConfig: string | null;
    imageId: string | null;
    imageDigest: string | null;
    imageArchitecture: string | null;
    runnerContractDigest: string | null;
    runnerImplementationDigest: string | null;
    toolInventoryDigest: string | null;
    codexVersion: string | null;
    codexExecutableIdentity: string | null;
    agentAdapterImplementationDigest: string | null;
  }>;
  authoritySecret: string | null;
  arbitraryLifecycle: string | null;
  nodeOptions: string | null;
}>;
export type FakeLifecycleEvent = Readonly<{
  kind: "invoke";
  command: string;
  target: string | null;
  args: readonly string[];
  environment: FakeLifecycleEnvironment;
}> | Readonly<{ kind: "signal"; signal: string; command: string; target: string | null }>;
export type FakeLifecycle = Readonly<{ executable: string; logPath: string; countPath: string; versionDelayPath: string }>;

export async function createFakeLifecycle(root: string): Promise<FakeLifecycle> {
  const packageRoot = join(root, "runtime-package");
  const executable = join(packageRoot, "bin", "lifecycle");
  const logPath = join(root, "events.jsonl");
  const countPath = join(root, "status-count.txt");
  const versionDelayPath = join(root, "slow-version");
  await mkdir(join(packageRoot, "bin"), { recursive: true, mode: 0o700 });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@neutral/lifecycle-runtime", version: "1.0.0", private: true }), { encoding: "utf8", mode: 0o600 });
  const lines = [
    "#!" + process.execPath,
    'const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");',
    'const { createHash } = require("node:crypto");',
    'const { basename } = require("node:path");',
    "const logPath = " + JSON.stringify(logPath) + ";",
    "const countPath = " + JSON.stringify(countPath) + ";",
    "const versionDelayPath = " + JSON.stringify(versionDelayPath) + ";",
    "const statusTemplate = " + JSON.stringify(testStatusResult()) + ";",
    "const prepareTemplate = " + JSON.stringify(testPrepareResult()) + ";",
    "const emptyAttemptViewTemplate = " + JSON.stringify(testAttemptViewResult({ empty: true })) + ";",
    "const attemptViewTemplate = " + JSON.stringify(testAttemptViewResult()) + ";",
    "const inboxTemplate = " + JSON.stringify(testInboxResult()) + ";",
    "const deliveryViewTemplate = " + JSON.stringify(testDeliveryViewResult()) + ";",
    "const controlRevisionTemplate = " + JSON.stringify(testControlRevision()) + ";",
    'const args = process.argv.slice(2), command = args[0] || "", target = args[1] || null;',
    'const execution = {dockerPath:process.env.LIFECYCLE_DOCKER_PATH||null,dockerHost:process.env.LIFECYCLE_DOCKER_HOST||null,dockerConfig:process.env.LIFECYCLE_DOCKER_CONFIG||null,imageId:process.env.LIFECYCLE_EXECUTION_IMAGE_ID||null,imageDigest:process.env.LIFECYCLE_EXECUTION_IMAGE_DIGEST||null,imageArchitecture:process.env.LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE||null,runnerContractDigest:process.env.LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST||null,runnerImplementationDigest:process.env.LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST||null,toolInventoryDigest:process.env.LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST||null,codexVersion:process.env.LIFECYCLE_EXECUTION_CODEX_VERSION||null,codexExecutableIdentity:process.env.LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY||null,agentAdapterImplementationDigest:process.env.LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST||null};',
    'const environment = { machineHome:process.env.LIFECYCLE_MACHINE_HOME||null, codexPath:process.env.LIFECYCLE_CODEX_PATH||null, model:process.env.LIFECYCLE_FOUNDATION_PROVIDER_MODEL||null, reasoning:process.env.LIFECYCLE_FOUNDATION_PROVIDER_REASONING||null, execution, authoritySecret:process.env.LIFECYCLE_AUTHORITY_SECRET||null, arbitraryLifecycle:process.env.LIFECYCLE_ARBITRARY_INJECTION||null, nodeOptions:process.env.NODE_OPTIONS||null };',
    'const record = (event) => appendFileSync(logPath, JSON.stringify(event) + "\\n", { encoding: "utf8", mode: 0o600 });',
    'const canonical = (v) => v === null ? "null" : ["string","number","boolean"].includes(typeof v) ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";',
    'const sha = (v) => "sha256:" + createHash("sha256").update(canonical(v)).digest("hex");',
    'const digest = (v) => { const c = { ...v }; delete c.digest; return sha(c); };',
    'const clone = (v) => JSON.parse(JSON.stringify(v));',
    'const targetId = () => "target-" + createHash("sha256").update(target || "missing").digest("hex").slice(0, 32);',
    'const mode=target === null ? "" : basename(target);',
    'const fail = (code, message, repositoryChanged=false, operationalStateChanged=false, recoveryActions=[], observedFacts) => { const error = { code, message, retryable:false, repositoryChanged, operationalStateChanged, recoveryActions, diagnostics:[{code:"fake-diagnostic"}] }; if (observedFacts !== undefined) error.observedFacts = observedFacts; process.stderr.write(JSON.stringify({error}) + "\\n"); };',
    'const cancel = () => { record({kind:"signal",signal:"SIGINT",command,target}); if(mode==="ignore-cancel")return; if(command!=="version")fail("lifecycle.test.cancelled","The fake Delivery read was cancelled."); process.exit(130); };',
    'process.on("SIGINT",cancel);',
    'const seal = (result, input=null, unresolved=false) => { const selectedTargetId=unresolved ? null : targetId(); result.observation.repository.targetId=selectedTargetId; const request = { schema:"lifecycle.foundation-runtime-facade.v10", target, operation:result.operation, input }; if (!["repository.validate","delivery.inbox","delivery.prepare"].includes(result.operation)) request.deliveryId = result.operation === "delivery.watch" && args[2] === "--input" ? null : args[2]; result.requestDigest = sha(request); result.targetId=selectedTargetId; result.deliveryId=["repository.validate","delivery.inbox"].includes(result.operation) ? null : (result.operation === "delivery.prepare" ? (result.observation.delivery && result.observation.delivery.processId) : request.deliveryId); if(selectedTargetId!==null && result.value && result.value.kind==="inbox") result.value.view.targetId=selectedTargetId; if(selectedTargetId!==null && result.value && result.value.kind==="watch" && result.value.inbox) result.value.inbox.targetId=selectedTargetId; result.digest=digest(result); return result; };',
    'record({kind:"invoke", command, target, args, environment});',
    'if (command === "version") { if (existsSync(versionDelayPath)) { setInterval(() => {},1000); } else { process.stdout.write(' + JSON.stringify(JSON.stringify(FOUNDATION_TUI_TEST_VERSION) + "\n") + '); process.exit(0); } }',
    'if (!["status","validate","inbox","inspect","diff","watch","prepare","continue","evaluate","revise","reaffirm"].includes(command)) { fail("fake.mutation-command","The fake Lifecycle refuses this command."); process.exit(97); }',
    'if (mode === "setup" || mode === "setup-repository-effect" || mode === "setup-operational-effect") { fail("lifecycle.repository.contract-missing","The Foundation repository contract is unavailable.",mode==="setup-repository-effect",mode==="setup-operational-effect"); process.exit(1); }',
    'if (command === "validate") { const result=clone(statusTemplate); result.operation="repository.validate"; result.deliveryId=null; result.observation.delivery=null; result.value=null; if(mode==="setup-observation") { result.observation.repository={schema:"lifecycle.repository-observation.v10",initialized:false,valid:false,targetId:null,repositoryContract:null,repositoryContractDigest:null,headCommit:null,headTree:null,productDigest:null,atlas:null,knowledgeDigest:null,checkBindingsDigest:null}; result.diagnostics=[{code:"lifecycle.repository.contract-missing",severity:"error",message:"The Foundation repository contract is unavailable.",retryable:false,facts:{}}]; } else if(mode==="invalid-observation") { result.observation.repository.valid=false; result.diagnostics=[{code:"lifecycle.repository.invalid",severity:"error",message:"The initialized Foundation repository is invalid.",retryable:false,facts:{}}]; } process.stdout.write(JSON.stringify(seal(result,null,mode==="setup-observation"))+"\\n"); process.exit(0); }',
    'if (command === "prepare" || ["continue","evaluate","revise","reaffirm"].includes(command)) { const index=args.indexOf("--input"); if(index < 0 || index+1 >= args.length) { fail("fake.semantic-input","Semantic operation requires one input file."); process.exit(2); } const input=readFileSync(args[index+1],"utf8"); const result=clone(command === "prepare" ? prepareTemplate : statusTemplate); result.operation=command === "prepare" ? "delivery.prepare" : "delivery."+command; const generationIndex=args.indexOf("--expected-generation"); const requestInput={semanticMarkdown:input}; if(generationIndex>=0) requestInput.expectedGeneration=args[generationIndex+1]; process.stdout.write(JSON.stringify(seal(result,requestInput))+"\\n"); process.exit(0); }',
    'let count=0; try { count=Number(readFileSync(countPath,"utf8"))||0; } catch {} count+=1; writeFileSync(countPath,String(count),{encoding:"utf8",mode:0o600});',
    'const earlyWait=mode==="slow" || mode==="ignore-cancel" || (mode==="refresh-slow" && count>1);',
    'if (mode === "unsafe-error") { fail("lifecycle.test.unsafe","unsafe status\\u001b[31m\\nspoof\\u202e"); process.exit(1); }',
    'if (mode === "typed-refusal") { fail("lifecycle.test.follow-up","The canonical read requires attention.",false,false,[{action:"inspect",detail:"Inspect exact Delivery facts."}],{target,basis:"repository"}); process.exit(1); }',
    'if(command==="inbox") { if(earlyWait) { setInterval(()=>{},1000);return; } if(mode==="setup-observation") { fail("lifecycle.repository.contract-missing","The Foundation repository contract is unavailable."); process.exit(1); } const index=args.indexOf("--input"); const input=JSON.parse(readFileSync(args[index+1],"utf8")); const result=clone(inboxTemplate); if(mode==="invalid-observation") result.observation.repository.valid=false; process.stdout.write(JSON.stringify(seal(result,input))+"\\n"); process.exit(0); }',
    'if(command==="inspect") { const index=args.indexOf("--input"); const input=JSON.parse(readFileSync(args[index+1],"utf8")); if(input.kind==="delivery-view") { process.stdout.write(JSON.stringify(seal(clone(deliveryViewTemplate),input))+"\\n"); process.exit(0); } if(input.kind==="families") { const result=clone(deliveryViewTemplate); const generation=clone(result.value.view.generation); const current={kind:controlRevisionTemplate.recordKind,id:controlRevisionTemplate.recordId,revision:controlRevisionTemplate.revision,digest:controlRevisionTemplate.digest}; result.value={kind:"families",generation,families:[{recordKind:controlRevisionTemplate.recordKind,recordCount:1,revisionCount:1,current}]}; process.stdout.write(JSON.stringify(seal(result,input))+"\\n"); process.exit(0); } if(input.kind==="family") { const result=clone(deliveryViewTemplate); const generation=clone(result.value.view.generation); result.value={kind:"family",generation,recordKind:input.recordKind,records:input.recordKind===controlRevisionTemplate.recordKind?[clone(controlRevisionTemplate)]:[],nextAfterRecordId:null}; process.stdout.write(JSON.stringify(seal(result,input))+"\\n"); process.exit(0); } if(input.kind==="revisions") { const result=clone(deliveryViewTemplate); const generation=clone(result.value.view.generation); result.value={kind:"revisions",generation,recordId:input.recordId,records:input.recordId===controlRevisionTemplate.recordId?[clone(controlRevisionTemplate)]:[],nextAfterRevision:null}; process.stdout.write(JSON.stringify(seal(result,input))+"\\n"); process.exit(0); } }',
    'if(command==="diff") { const index=args.indexOf("--input"); const input=JSON.parse(readFileSync(args[index+1],"utf8")); const result=clone(deliveryViewTemplate); const content="diff --git a/example b/example\\n+bounded change\\n"; result.operation="delivery.diff"; result.value={kind:"diff",view:{schema:"lifecycle.delivery-diff.v1",generation:result.value.view.generation,subject:input.subject,currentness:"exact",candidate:result.value.view.currentSubjects.candidate,seal:result.value.view.currentSubjects.seal,baseCommit:result.observation.repository.headCommit,tree:result.observation.repository.headTree,exactDiffDigest:null,contentDigest:null,byteLength:Buffer.byteLength(content),truncated:false,content,unavailableReason:null}}; process.stdout.write(JSON.stringify(seal(result,input))+"\\n"); process.exit(0); }',
    'if(command==="watch") { const index=args.indexOf("--input"); const input=JSON.parse(readFileSync(args[index+1],"utf8")); const result=clone(input.scope==="delivery" ? deliveryViewTemplate : inboxTemplate); result.operation="delivery.watch"; const view=result.value.view; const generation=input.scope==="delivery"?view.generation.digest:view.generation; result.value={kind:"watch",scope:input.scope,changed:input.afterGeneration===null||input.afterGeneration!==generation,generation,inbox:input.scope==="inbox"?view:null,delivery:input.scope==="delivery"?view:null}; setTimeout(()=>{process.stdout.write(JSON.stringify(seal(result,input))+"\\n");process.exit(0);},Math.min(100,input.timeoutMs)); return; }',
    'const wait=mode==="slow" || mode==="ignore-cancel" || (mode==="refresh-slow" && count>1); if(wait) { setInterval(()=>{},1000); } else if (command === "inspect") { const index=args.indexOf("--input"); if(index < 0 || index+1 >= args.length) { fail("fake.inspect-input","Inspect requires one input file."); process.exit(2); } const input=JSON.parse(readFileSync(args[index+1],"utf8")); const prepared=readFileSync(logPath,"utf8").includes("\\\"command\\\":\\\"prepare\\\""); process.stdout.write(JSON.stringify(seal(clone(prepared ? attemptViewTemplate : emptyAttemptViewTemplate),input))+"\\n"); } else process.stdout.write(JSON.stringify(seal(clone(statusTemplate)))+"\\n");',
  ];
  await writeFile(executable, lines.join("\n"), { encoding: "utf8", mode: 0o700 });
  await chmod(executable, 0o700);
  return Object.freeze({ executable, logPath, countPath, versionDelayPath });
}

export async function readFakeLifecycleEvents(fake: FakeLifecycle): Promise<readonly FakeLifecycleEvent[]> {
  try { const source = await readFile(fake.logPath, "utf8"); return Object.freeze(source.trim() === "" ? [] : source.trim().split("\n").map((line) => JSON.parse(line) as FakeLifecycleEvent)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]); throw error; }
}
export async function waitForFakeLifecycleInvocations(fake: FakeLifecycle, count: number, timeoutMs = 3_000): Promise<readonly FakeLifecycleEvent[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const events = await readFakeLifecycleEvents(fake); if (events.filter((event) => event.kind === "invoke").length >= count) return events; if (Date.now() >= deadline) throw new Error("Fake Lifecycle did not observe invocation"); await new Promise<void>((resolve) => setTimeout(resolve, 10)); }
}
export function fakeLifecycleCommands(events: readonly FakeLifecycleEvent[]): readonly string[] {
  return Object.freeze(events.filter((event): event is Extract<FakeLifecycleEvent, { kind: "invoke" }> => event.kind === "invoke").map((event) => event.command));
}
