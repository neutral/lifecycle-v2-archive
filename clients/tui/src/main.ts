import type { ReadStream, WriteStream } from "node:tty";
import { createLifecycleCliTransport, FoundationCliReportedError, FoundationTuiTransportError, type LifecycleCliTransport } from "./adapters/cli/transport.js";
import {
  createDeliveryViewLifecycleTuiSnapshot,
  createInboxLifecycleTuiSnapshot,
  createSetupLifecycleTuiSnapshot,
  createUninitializedLifecycleTuiSnapshot,
  lifecycleTuiReviewAction,
  lifecycleTuiSnapshotActionCount,
  type LifecycleTuiSnapshot,
} from "./app/snapshot.js";
import { createLifecycleTuiState } from "./app/state.js";
import { updateLifecycleTui } from "./app/update.js";
import { LIFECYCLE_TUI_USAGE, parseLifecycleTuiConfig } from "./config.js";
import { createLifecycleCliHandoff, renderLifecycleCliHandoff, type HandoffInputKind, type LifecycleCliHandoff } from "./domain/handoff.js";
import { foundationTuiOperationPolicy, type TuiOperationInputKind } from "./domain/operation-policy.js";
import { renderLifecyclePlainSnapshot } from "./view/plain.js";
import { TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS, tuiSafeJson, tuiSafeLine } from "./view/sanitize.js";

const SETUP_REQUIRED_CODE = "lifecycle.repository.contract-missing";

export function isNoEffectSetupFailure(error: unknown): error is FoundationCliReportedError {
  return error instanceof FoundationCliReportedError && error.failure.code === SETUP_REQUIRED_CODE &&
    !error.failure.repositoryChanged && !error.failure.operationalStateChanged;
}

export function lifecycleReadFailureMessage(error: unknown): string {
  if (error instanceof FoundationCliReportedError) {
    const failure = error.failure;
    const recovery = failure.recoveryActions.slice(0, 8).map(({ action, detail }) => `${tuiSafeLine(action, 512)} — ${tuiSafeLine(detail, 2_048)}`);
    const facts = failure.observedFacts === undefined ? null : tuiSafeLine(tuiSafeJson(failure.observedFacts), 2_048);
    return tuiSafeLine([
      `CLI REFUSAL ${failure.code}`, failure.message,
      `retryable=${String(failure.retryable)} · repositoryChanged=${String(failure.repositoryChanged)} · operationalStateChanged=${String(failure.operationalStateChanged)}`,
      ...(recovery.length === 0 ? [] : [`recovery: ${recovery.join(" · ")}`]),
      ...(facts === null ? [] : [`observed facts: ${facts}`]),
    ].join(" · "), TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS);
  }
  if (error instanceof FoundationTuiTransportError) {
    return tuiSafeLine(`TRANSPORT FAILURE ${error.code}: ${error.message}`, TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS);
  }
  return tuiSafeLine(error instanceof Error ? error.message : "Lifecycle status failed", TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS);
}

function handoffInputKind(input: TuiOperationInputKind): HandoffInputKind {
  return input === "initialization" ? "initialization-file" : input === "semantic-markdown" ? "semantic-markdown-file" : "none";
}

function createHandoff(transport: LifecycleCliTransport, target: string, snapshot: LifecycleTuiSnapshot, index: number): LifecycleCliHandoff | null {
  const action = lifecycleTuiReviewAction(snapshot, index);
  if (action === null || action.protocolOperation === null) return null;
  const policy = foundationTuiOperationPolicy(action.protocolOperation);
  const observation = snapshot.kind === "observed" ? snapshot.observation : null;
  const deliveryId = [
    "repository.initialize",
    "repository.validate",
    "delivery.prepare",
  ].includes(action.protocolOperation)
    ? null
    : observation?.delivery?.processId ?? null;
  return createLifecycleCliHandoff({
    operation: action.protocolOperation,
    executable: transport.executable.physicalPath, command: policy.cliCommand, target,
    deliveryId,
    inputKind: handoffInputKind(policy.inputKind), authoritySecretRequired: policy.authoritySecretRequired,
    reviewed: {
      targetId: observation?.repository.targetId ?? null,
      deliveryId,
      repositoryContractDigest: observation?.repository.repositoryContractDigest ?? null,
      headCommit: observation?.repository.headCommit ?? null,
    },
  });
}

export function snapshotOperationAvailability(snapshot: LifecycleTuiSnapshot): Readonly<{ prepareAvailable: boolean; admitActionIndex: number | null }> {
  if (snapshot.kind === "frame-ready") return Object.freeze({ prepareAvailable: true, admitActionIndex: null });
  if (snapshot.kind === "inbox") return Object.freeze({
    prepareAvailable: snapshot.result.observation.repository.initialized &&
      snapshot.result.observation.repository.valid,
    admitActionIndex: null,
  });
  if (snapshot.kind !== "observed") return Object.freeze({ prepareAvailable: false, admitActionIndex: null });
  // Each Frame submission starts a separate fresh reconnaissance Delivery; it is not
  // contingent on an existing Delivery's later-operation eligibility.
  const prepareAvailable = snapshot.observation.repository.initialized && snapshot.observation.repository.valid;
  const index = snapshot.presentation.actions.findIndex(({ operationId }) => operationId === "delivery.admit");
  return Object.freeze({ prepareAvailable, admitActionIndex: index < 0 ? null : index });
}

export class LifecycleReadSignalScope {
  readonly #graceful = new AbortController();
  readonly #force = new AbortController();
  #exitCode = 0;
  #interruptCount = 0;
  #handler: ((exitCode: number) => void) | null = null;
  #closed = false;
  readonly #sigint = (): void => this.#interrupt(130);
  readonly #sigterm = (): void => this.#interrupt(143);
  readonly #sighup = (): void => this.#interrupt(129);
  constructor() { process.on("SIGINT", this.#sigint); process.on("SIGTERM", this.#sigterm); process.on("SIGHUP", this.#sighup); }
  get cancellation(): Readonly<{ signal: AbortSignal; forceSignal: AbortSignal }> { return Object.freeze({ signal: this.#graceful.signal, forceSignal: this.#force.signal }); }
  get exitCode(): number { return this.#exitCode; }
  get signal(): AbortSignal { return this.#graceful.signal; }
  useInteractiveHandler(handler: (exitCode: number) => void): () => void {
    if (this.#closed || this.#handler !== null) throw new Error("Lifecycle signal scope is not available");
    this.#handler = handler;
    if (this.#exitCode !== 0) handler(this.#exitCode);
    return () => { if (this.#handler === handler) this.#handler = null; };
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    process.removeListener("SIGINT", this.#sigint); process.removeListener("SIGTERM", this.#sigterm); process.removeListener("SIGHUP", this.#sighup);
  }
  #interrupt(code: number): void {
    if (this.#exitCode === 0) this.#exitCode = code;
    this.#interruptCount += 1;
    if (this.#interruptCount === 1) this.#graceful.abort(); else this.#force.abort();
    this.#handler?.(this.#exitCode);
  }
}

async function writeCancellable(output: NodeJS.WriteStream, value: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true; signal?.removeEventListener("abort", abort); error ? reject(error) : resolve();
    };
    const abort = (): void => finish();
    signal?.addEventListener("abort", abort, { once: true });
    output.write(value, (error) => finish(error));
  });
}

export async function writeSignalAwareOutput(render: () => string, output: NodeJS.WriteStream, signals: Readonly<{ exitCode: number; signal?: AbortSignal }>): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (signals.exitCode !== 0) return;
  const rendered = render();
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (signals.exitCode !== 0) return;
  await writeCancellable(output, rendered, signals.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function runPlain(transport: LifecycleCliTransport, target: string, deliveryId: string | null, output: NodeJS.WriteStream, errorOutput: NodeJS.WriteStream, signals: LifecycleReadSignalScope): Promise<number> {
  try {
    const validation = await transport.validate(target, signals.cancellation);
    if (signals.exitCode !== 0) return signals.exitCode;
    if (!validation.observation.repository.initialized) {
      const snapshot = createUninitializedLifecycleTuiSnapshot(target, validation);
      let state = createLifecycleTuiState<LifecycleTuiSnapshot>({ columns: 100, rows: 2_048 });
      state = updateLifecycleTui(state, { kind: "start" }).state;
      state = updateLifecycleTui(state, {
        kind: "refresh-succeeded",
        sequence: 1,
        model: snapshot,
        actionCount: 1,
        prepareAvailable: false,
        admitActionIndex: null,
        observedAt: Date.now(),
      }).state;
      await writeSignalAwareOutput(() => renderLifecyclePlainSnapshot(state, target), output, signals);
      return signals.exitCode;
    }
    if (!validation.observation.repository.valid) {
      throw new Error("The initialized repository is invalid; Delivery reads are unavailable.");
    }
    const inbox = createInboxLifecycleTuiSnapshot(await transport.inbox(target, undefined, signals.cancellation));
    if (signals.exitCode !== 0) return signals.exitCode;
    const snapshot = deliveryId === null
      ? inbox
      : createDeliveryViewLifecycleTuiSnapshot(
          await transport.inspectDeliveryView(target, deliveryId, signals.cancellation),
          inbox.inbox,
        );
    let state = createLifecycleTuiState<LifecycleTuiSnapshot>({ columns: 100, rows: 2_048 });
    state = updateLifecycleTui(state, { kind: "start" }).state;
    state = updateLifecycleTui(state, {
      kind: "refresh-succeeded",
      sequence: 1,
      model: snapshot,
      actionCount: lifecycleTuiSnapshotActionCount(snapshot),
      ...snapshotOperationAvailability(snapshot),
      ...(snapshot.kind === "observed" && snapshot.deliveryView !== null
        ? {
            selectedDelivery: {
              deliveryId: snapshot.deliveryView.generation.processId,
              generation: snapshot.deliveryView.generation.digest,
            },
            nextPassAvailable: snapshot.deliveryView.nextPass
              .filter(({ eligible }) => eligible)
              .map(({ operation }) => operation),
            inboxCount: snapshot.inbox?.rows.length ?? 0,
          }
        : { inboxCount: snapshot.kind === "inbox" ? snapshot.inbox.rows.length : 0 }),
      observedAt: Date.now(),
    }).state;
    await writeSignalAwareOutput(() => renderLifecyclePlainSnapshot(state, target), output, signals);
    return signals.exitCode;
  } catch (error) {
    if (signals.exitCode !== 0) return signals.exitCode;
    if (isNoEffectSetupFailure(error)) {
      const snapshot = createSetupLifecycleTuiSnapshot(target, error.failure);
      let state = createLifecycleTuiState<LifecycleTuiSnapshot>({ columns: 100, rows: 2_048 });
      state = updateLifecycleTui(state, { kind: "start" }).state;
      state = updateLifecycleTui(state, { kind: "refresh-succeeded", sequence: 1, model: snapshot, actionCount: 1, prepareAvailable: false, admitActionIndex: null, observedAt: Date.now() }).state;
      await writeSignalAwareOutput(() => renderLifecyclePlainSnapshot(state, target), output, signals);
      return signals.exitCode;
    }
    await writeSignalAwareOutput(() => `Lifecycle TUI status unavailable: ${lifecycleReadFailureMessage(error)}\n`, errorOutput, signals).catch(() => undefined);
    return signals.exitCode === 0 ? 1 : signals.exitCode;
  }
}

function interactiveBunAvailable(): boolean {
  const version = (globalThis as { Bun?: { version?: string } }).Bun?.version;
  const match = version === undefined ? null : /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (match === null) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 1 || (major === 1 && minor >= 3);
}

export type OpenTuiPlatformFacts = Readonly<{
  platform: string;
  glibcVersionRuntime?: unknown;
}>;

function reportsGlibc(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.length > 0);
}

function currentOpenTuiPlatformFacts(): OpenTuiPlatformFacts {
  let glibcVersionRuntime: unknown;
  try {
    const report = process.report?.getReport() as Readonly<{ header?: Readonly<{ glibcVersionRuntime?: unknown }> }> | undefined;
    glibcVersionRuntime = report?.header?.glibcVersionRuntime;
  } catch {
    glibcVersionRuntime = undefined;
  }
  return Object.freeze({ platform: process.platform, glibcVersionRuntime });
}

export function neutralizeOpenTuiEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platformFacts: OpenTuiPlatformFacts = currentOpenTuiPlatformFacts(),
): void {
  for (const key of Object.keys(environment)) {
    if (key.startsWith("OTUI_") || key.startsWith("OPENTUI_")) delete environment[key];
  }
  if (platformFacts.platform === "linux") {
    environment.OPENTUI_LIBC = reportsGlibc(platformFacts.glibcVersionRuntime)
      ? "glibc"
      : "musl";
  }
}

export async function runLifecycleTui(args: readonly string[]): Promise<number> {
  const config = parseLifecycleTuiConfig(args);
  if (config.help) { process.stdout.write(LIFECYCLE_TUI_USAGE); return 0; }
  const signals = new LifecycleReadSignalScope();
  try {
    const transport = await createLifecycleCliTransport({ executable: "lifecycle", pinCancellation: signals.cancellation });
    if (signals.exitCode !== 0) return signals.exitCode;
    if (!process.stdin.isTTY || !process.stdout.isTTY) return await runPlain(transport, config.target, config.deliveryId, process.stdout, process.stderr, signals);
    if (!interactiveBunAvailable()) throw new Error("Interactive lifecycle-tui requires Bun 1.3.0 or newer.");
    neutralizeOpenTuiEnvironment();
    let resolveImportSignal!: (code: number) => void;
    const importSignal = new Promise<number>((resolve) => { resolveImportSignal = resolve; });
    const removeImportSignal = signals.useInteractiveHandler(resolveImportSignal);
    const importing = import("./opentui/application.js");
    const imported = await Promise.race([
      importing.then((module) => ({ kind: "module" as const, module })),
      importSignal.then((code) => ({ kind: "signal" as const, code })),
    ]).finally(removeImportSignal);
    if (imported.kind === "signal") {
      void importing.catch(() => undefined);
      return imported.code;
    }
    const { runOpenTuiApplication } = imported.module;
    const result = await runOpenTuiApplication({ transport, target: config.target, deliveryId: config.deliveryId, refreshIntervalMs: config.refreshIntervalMs, input: process.stdin as ReadStream, output: process.stdout as WriteStream, signals });
    if (signals.exitCode !== 0) return signals.exitCode;
    if (result.selectedAction !== null && result.snapshot !== null) {
      const handoff = createHandoff(transport, config.target, result.snapshot, result.selectedAction);
      if (handoff !== null) await writeSignalAwareOutput(() => renderLifecycleCliHandoff(handoff), process.stdout, signals);
    }
    return result.exitCode;
  } catch (error) {
    if (signals.exitCode !== 0) return signals.exitCode;
    throw error;
  } finally { signals.close(); }
}
