import type { ReadStream, WriteStream } from "node:tty";
import { CliRenderEvents, createCliRenderer, type CliRenderer } from "@opentui/core";
import type { FoundationDeliveryGeneration, FoundationPrepareResult, LifecycleCliTransport } from "../adapters/cli/transport.js";
import {
  createDeliveryViewLifecycleTuiSnapshot,
  createInboxLifecycleTuiSnapshot,
  createSetupLifecycleTuiSnapshot,
  createUninitializedLifecycleTuiSnapshot,
  lifecycleTuiSnapshotActionCount,
  type LifecycleTuiSnapshot,
} from "../app/snapshot.js";
import {
  createLifecycleTuiState,
  type FoundationTuiNextPassOperation,
  type LifecycleTuiDeliveryBinding,
  type LifecycleTuiState,
} from "../app/state.js";
import { updateLifecycleTui, type LifecycleTuiEffect, type LifecycleTuiEvent } from "../app/update.js";
import { isNoEffectSetupFailure, lifecycleReadFailureMessage, snapshotOperationAvailability, type LifecycleReadSignalScope } from "../main.js";
import { tuiSafeJson, tuiSafeText } from "../view/sanitize.js";
import { LifecycleOpenTuiView } from "./view.js";

const QUIT_FORCE_MS = 1_000;
type ActiveInvocation = { readonly graceful: AbortController; readonly force: AbortController; promise: Promise<void>; cancellationCount: number };

export type OpenTuiApplicationOptions = Readonly<{
  transport: LifecycleCliTransport;
  target: string;
  deliveryId: string | null;
  refreshIntervalMs: number;
  input: ReadStream;
  output: WriteStream;
  signals: LifecycleReadSignalScope;
}>;

export type OpenTuiApplicationResult = Readonly<{ exitCode: number; selectedAction: number | null; snapshot: LifecycleTuiSnapshot | null }>;

type OpenTuiSessionRenderer = Pick<CliRenderer, "disableKittyKeyboard" | "useKittyKeyboard">;
type OpenTuiDestroyRenderer = Readonly<{
  destroy: () => void;
  stop: () => void;
  suspend: () => void;
}>;
type OpenTuiSessionView = Pick<LifecycleOpenTuiView, "release">;

export function preparedDeliveryIdentity(result: FoundationPrepareResult): string {
  if (result.deliveryId === null || result.observation.delivery?.processId !== result.deliveryId) {
    throw new Error("Completed Frame preparation did not return one exact Delivery identity");
  }
  return result.deliveryId;
}

/** Bind Control inspection presentation to the generation the runtime actually observed. */
export function controlInspectionSubject(
  requested: LifecycleTuiDeliveryBinding,
  returned: FoundationDeliveryGeneration,
): Readonly<{ generation: string; stale: boolean }> {
  if (returned.processId !== requested.deliveryId) {
    throw new Error("Control inspection returned a different Delivery identity");
  }
  return Object.freeze({
    generation: returned.digest,
    stale: returned.digest !== requested.generation,
  });
}

/**
 * OpenTUI 0.5.9 incorrectly coalesces a null Kitty configuration to its
 * defaults. Disable the native mode and parser context together before any
 * application input can be accepted.
 */
export function disableOpenTuiKeyboardExtensions(renderer: Pick<OpenTuiSessionRenderer, "disableKittyKeyboard" | "useKittyKeyboard">): void {
  renderer.disableKittyKeyboard();
  if (renderer.useKittyKeyboard) throw new Error("OpenTUI keyboard extensions could not be disabled");
}

/**
 * Stop future frames and synchronously suspend terminal ownership before
 * destroy. OpenTUI owns safe deferred tree/native finalization when a frame is
 * already active; the view first releases its external handlers without
 * mutating that tree. Handoff output can follow because suspend—not the early
 * DESTROY event—is the terminal-restoration edge.
 */
export async function destroyOpenTuiSession(view: OpenTuiSessionView | null, renderer: OpenTuiDestroyRenderer): Promise<void> {
  let viewFailure: unknown = null;
  try {
    renderer.stop();
    renderer.suspend();
    view?.release();
  } catch (error) {
    viewFailure = error;
  }
  renderer.destroy();
  if (viewFailure !== null) throw viewFailure;
}

/**
 * OpenTUI callbacks already run on one JavaScript event loop. Reducing them
 * synchronously avoids a pressure queue in which a newer draft or a control
 * key could be discarded behind cosmetic timer/resize events.
 */
export function createOpenTuiEventDispatcher<Event>(options: Readonly<{
  accept: () => boolean;
  process: (event: Event) => void;
  fail: (error: unknown) => void;
}>): (event: Event) => void {
  return (event): void => {
    if (!options.accept()) return;
    try { options.process(event); } catch (error) { options.fail(error); }
  };
}

export async function runOpenTuiApplication(options: OpenTuiApplicationOptions): Promise<OpenTuiApplicationResult> {
  if (options.signals.exitCode !== 0) {
    return Object.freeze({ exitCode: options.signals.exitCode, selectedAction: null, snapshot: null });
  }
  let resolveBootstrapSignal!: (code: number) => void;
  const bootstrapSignal = new Promise<number>((resolve) => { resolveBootstrapSignal = resolve; });
  const removeBootstrapSignal = options.signals.useInteractiveHandler(resolveBootstrapSignal);
  const creatingRenderer = createCliRenderer({
    stdin: options.input, stdout: options.output, screenMode: "alternate-screen", consoleMode: "disabled",
    exitOnCtrlC: false, exitSignals: [], clearOnShutdown: true, openConsoleOnError: false,
    useMouse: false, autoFocus: false,
    useKittyKeyboard: { disambiguate: false, alternateKeys: false, events: false, allKeysAsEscapes: false, reportText: false },
    stdinParserMaxBufferBytes: 128 * 1_024,
  });
  const bootstrap = await Promise.race([
    creatingRenderer.then((renderer) => ({ kind: "renderer" as const, renderer })),
    bootstrapSignal.then((code) => ({ kind: "signal" as const, code })),
  ]).finally(removeBootstrapSignal);
  if (bootstrap.kind === "signal") {
    void creatingRenderer.then(async (renderer) => destroyOpenTuiSession(null, renderer)).catch(() => undefined);
    return Object.freeze({ exitCode: bootstrap.code, selectedAction: null, snapshot: null });
  }
  const renderer = bootstrap.renderer;
  let view: LifecycleOpenTuiView | null = null;
    let active: ActiveInvocation | null = null;
    let watchActive: ActiveInvocation | null = null;
  let quitForceTimer: NodeJS.Timeout | null = null;
  let removeSignal: (() => void) | null = null;
  let onRenderError: ((event: unknown) => void) | null = null;
    let poll: NodeJS.Timeout | null = null;
  try {
    disableOpenTuiKeyboardExtensions(renderer);
    if (options.signals.exitCode !== 0) {
      return Object.freeze({ exitCode: options.signals.exitCode, selectedAction: null, snapshot: null });
    }
    let state: LifecycleTuiState<LifecycleTuiSnapshot> = createLifecycleTuiState({ columns: renderer.width, rows: renderer.height });
    let exitRequested = false;
    let exitCode = 0;
    let selectedAction: number | null = null;
    let fatal: unknown = null;
    let completeQuit!: () => void;
    const quitComplete = new Promise<void>((resolve) => { completeQuit = resolve; });

    const cancelInvocation = (): void => {
      if (active === null) return;
      active.cancellationCount += 1;
      if (active.cancellationCount === 1) active.graceful.abort(); else active.force.abort();
    };
    const cancelWatch = (): void => {
      if (watchActive === null) return;
      watchActive.cancellationCount += 1;
      if (watchActive.cancellationCount === 1) watchActive.graceful.abort();
      else watchActive.force.abort();
    };
    const beginQuit = (action: number | null, requestedCode = 0): void => {
      if (requestedCode !== 0 && exitCode === 0) exitCode = requestedCode;
      if (action !== null) selectedAction = action;
      if (exitRequested) { cancelInvocation(); return; }
      exitRequested = true;
      cancelWatch();
      if (active === null && watchActive === null) completeQuit();
      else {
        if (active !== null && active.cancellationCount === 0) cancelInvocation();
        quitForceTimer = setTimeout(() => {
          active?.force.abort();
          watchActive?.force.abort();
        }, QUIT_FORCE_MS);
        quitForceTimer.unref();
        void Promise.allSettled([
          active?.promise ?? Promise.resolve(),
          watchActive?.promise ?? Promise.resolve(),
        ]).then(() => completeQuit());
      }
    };
    let dispatch!: (event: LifecycleTuiEvent<LifecycleTuiSnapshot>) => void;
    let activeDeliveryId = options.deliveryId;
    const availability = (snapshot: LifecycleTuiSnapshot): Readonly<{
      prepareAvailable: boolean;
      admitActionIndex: number | null;
      selectedDelivery: LifecycleTuiDeliveryBinding | null;
      nextPassAvailable: readonly FoundationTuiNextPassOperation[];
      inboxCount: number;
    }> => {
      const base = snapshotOperationAvailability(snapshot);
      if (snapshot.kind !== "observed" || snapshot.deliveryView === null) {
        return Object.freeze({
          ...base,
          selectedDelivery: null,
          nextPassAvailable: Object.freeze([]),
          inboxCount: snapshot.kind === "inbox" ? snapshot.inbox.rows.length : 0,
        });
      }
      return Object.freeze({
        ...base,
        selectedDelivery: Object.freeze({
          deliveryId: snapshot.deliveryView.generation.processId,
          generation: snapshot.deliveryView.generation.digest,
        }),
        nextPassAvailable: Object.freeze(snapshot.deliveryView.nextPass
          .filter(({ eligible }) => eligible)
          .map(({ operation }) => operation)),
        inboxCount: snapshot.inbox?.rows.length ?? 0,
      });
    };

    const startRefresh = (sequence: number): void => {
      if (active !== null || exitRequested) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      active = current;
      const release = (): void => { if (active === current) active = null; };
      current.promise = options.transport.validate(options.target, {
        signal: current.graceful.signal,
        forceSignal: current.force.signal,
      }).then(async (validation) => {
        if (!validation.observation.repository.initialized) {
          const snapshot = createUninitializedLifecycleTuiSnapshot(options.target, validation);
          release();
          dispatch({
            kind: "refresh-succeeded",
            sequence,
            model: snapshot,
            actionCount: 1,
            prepareAvailable: false,
            admitActionIndex: null,
            inboxCount: 0,
            observedAt: Date.now(),
          });
          return;
        }
        if (!validation.observation.repository.valid) {
          throw new Error("The initialized repository is invalid; Delivery reads are unavailable.");
        }
        const inboxResult = await options.transport.inbox(options.target, undefined, {
          signal: current.graceful.signal,
          forceSignal: current.force.signal,
        });
        const inboxSnapshot = createInboxLifecycleTuiSnapshot(inboxResult);
        const snapshot = activeDeliveryId === null
          ? inboxSnapshot
          : createDeliveryViewLifecycleTuiSnapshot(
              await options.transport.inspectDeliveryView(options.target, activeDeliveryId, {
                signal: current.graceful.signal,
                forceSignal: current.force.signal,
              }),
              inboxSnapshot.inbox,
            );
        release();
        dispatch({
          kind: "refresh-succeeded",
          sequence,
          model: snapshot,
          actionCount: lifecycleTuiSnapshotActionCount(snapshot),
          ...availability(snapshot),
          observedAt: Date.now(),
        });
        }).catch((error: unknown) => {
          release();
          if (isNoEffectSetupFailure(error)) {
            const snapshot = createSetupLifecycleTuiSnapshot(options.target, error.failure);
            dispatch({ kind: "refresh-succeeded", sequence, model: snapshot, actionCount: 1, prepareAvailable: false, admitActionIndex: null, observedAt: Date.now() });
          } else dispatch({ kind: "refresh-failed", sequence, message: lifecycleReadFailureMessage(error), observedAt: Date.now() });
        }).finally(release);
    };
    const startPrepare = (sequence: number, input: string): void => {
      if (active !== null || exitRequested) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      active = current;
      const release = (): void => { if (active === current) active = null; };
      current.promise = options.transport.prepare(options.target, input, { signal: current.graceful.signal, forceSignal: current.force.signal })
        .then(async (result) => {
          activeDeliveryId = preparedDeliveryIdentity(result);
          const inbox = createInboxLifecycleTuiSnapshot(await options.transport.inbox(
            options.target,
            undefined,
            { signal: current.graceful.signal, forceSignal: current.force.signal },
          ));
          const snapshot = createDeliveryViewLifecycleTuiSnapshot(
            await options.transport.inspectDeliveryView(
              options.target,
              activeDeliveryId,
              { signal: current.graceful.signal, forceSignal: current.force.signal },
            ),
            inbox.inbox,
          );
          release();
          dispatch({
            kind: "prepare-succeeded",
            sequence,
            model: snapshot,
            actionCount: lifecycleTuiSnapshotActionCount(snapshot),
            ...availability(snapshot),
            status: result.status,
            observedAt: Date.now(),
          });
        }).catch((error: unknown) => {
          release();
          dispatch({ kind: "prepare-failed", sequence, message: lifecycleReadFailureMessage(error), refreshRequired: true, observedAt: Date.now() });
        }).finally(release);
    };

    const inspectCurrent = async (current: ActiveInvocation): Promise<LifecycleTuiSnapshot> => {
      if (activeDeliveryId === null) {
        return createInboxLifecycleTuiSnapshot(await options.transport.inbox(
          options.target,
          undefined,
          { signal: current.graceful.signal, forceSignal: current.force.signal },
        ));
      }
      const inbox = createInboxLifecycleTuiSnapshot(await options.transport.inbox(
        options.target,
        undefined,
        { signal: current.graceful.signal, forceSignal: current.force.signal },
      ));
      return createDeliveryViewLifecycleTuiSnapshot(
        await options.transport.inspectDeliveryView(
          options.target,
          activeDeliveryId,
          { signal: current.graceful.signal, forceSignal: current.force.signal },
        ),
        inbox.inbox,
      );
    };

    const startNextPass = (
      sequence: number,
      operation: FoundationTuiNextPassOperation,
      binding: LifecycleTuiDeliveryBinding,
      input: string,
    ): void => {
      if (active !== null || exitRequested) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      active = current;
      const release = (): void => { if (active === current) active = null; };
      current.promise = options.transport.executeNextPass(
        options.target,
        binding.deliveryId,
        operation,
        input,
        binding.generation,
        { signal: current.graceful.signal, forceSignal: current.force.signal },
      ).then(async (result) => {
        activeDeliveryId = binding.deliveryId;
        const snapshot = await inspectCurrent(current);
        if (snapshot.kind !== "observed" || snapshot.deliveryView === null) {
          throw new Error("Completed next pass did not produce one exact Delivery view");
        }
        const currentAvailability = availability(snapshot);
        const nextBinding = currentAvailability.selectedDelivery;
        if (nextBinding === null) throw new Error("Completed next pass did not return one exact Delivery generation");
        release();
        dispatch({
          kind: "operation-succeeded",
          sequence,
          model: snapshot,
          binding: nextBinding,
          actionCount: lifecycleTuiSnapshotActionCount(snapshot),
          prepareAvailable: currentAvailability.prepareAvailable,
          admitActionIndex: currentAvailability.admitActionIndex,
          nextPassAvailable: currentAvailability.nextPassAvailable,
          inboxCount: currentAvailability.inboxCount,
          status: result.status,
          observedAt: Date.now(),
        });
      }).catch((error: unknown) => {
        release();
        dispatch({
          kind: "operation-failed",
          sequence,
          message: lifecycleReadFailureMessage(error),
          refreshRequired: true,
          observedAt: Date.now(),
        });
      }).finally(release);
    };

    const startDiff = (
      sequence: number,
      binding: LifecycleTuiDeliveryBinding,
      subject: "candidate" | "decision",
    ): void => {
      if (active !== null || exitRequested) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      active = current;
      const release = (): void => { if (active === current) active = null; };
      current.promise = options.transport.diff(
        options.target,
        binding.deliveryId,
        { subject, maximumBytes: 256 * 1_024 },
        { signal: current.graceful.signal, forceSignal: current.force.signal },
      ).then((result) => {
        if (result.operation !== "delivery.diff" || result.status !== "completed" ||
            result.value === null || !("kind" in result.value) || result.value.kind !== "diff") {
          throw new Error("Completed diff read did not return one exact runtime diff");
        }
        const diff = result.value.view;
        const safe = tuiSafeText(diff.content ?? diff.unavailableReason ?? "Runtime diff unavailable.", 256 * 1_024);
        release();
        dispatch({
          kind: "auxiliary-succeeded",
          sequence,
          modal: Object.freeze({
            kind: "diff",
            deliveryId: binding.deliveryId,
            generation: diff.generation.digest,
            subject,
            title: subject === "decision" ? "Decision-bound Candidate diff" : "Current Candidate diff",
            body: safe.value,
            truncated: diff.truncated || !safe.complete,
            stale: diff.generation.digest !== binding.generation || diff.currentness !== "exact",
          }),
        });
      }).catch((error: unknown) => {
        release();
        dispatch({ kind: "auxiliary-failed", sequence, message: lifecycleReadFailureMessage(error) });
      }).finally(release);
    };

    const startControl = (
      sequence: number,
      binding: LifecycleTuiDeliveryBinding,
      selection: Extract<LifecycleTuiEffect, { kind: "load-control" }>["selection"],
    ): void => {
      if (active !== null || exitRequested) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      active = current;
      const release = (): void => { if (active === current) active = null; };
      const query = selection.kind === "families"
        ? selection
        : selection.kind === "family"
          ? Object.freeze({ kind: "family" as const, recordKind: selection.recordKind, afterRecordId: null, limit: 200 })
          : Object.freeze({ kind: "revisions" as const, recordId: selection.recordId, afterRevision: 0, limit: 200 });
      current.promise = options.transport.inspectControl(
        options.target,
        binding.deliveryId,
        query,
        { signal: current.graceful.signal, forceSignal: current.force.signal },
      ).then((result) => {
        if (result.operation !== "delivery.inspect" || result.status !== "completed" ||
            result.value === null || !("kind" in result.value)) {
          throw new Error("Completed Control read did not return one exact inspection selection");
        }
        let modal: Extract<NonNullable<LifecycleTuiState<LifecycleTuiSnapshot>["modal"]>, { kind: "control" }>;
        if (selection.kind === "families") {
          if (result.value.kind !== "families") {
            throw new Error("Completed Control read did not return exact family summaries");
          }
          const subject = controlInspectionSubject(binding, result.value.generation);
          modal = Object.freeze({
            kind: "control" as const,
            deliveryId: binding.deliveryId,
            generation: subject.generation,
            title: "Control families",
            body: result.value.families.length === 0
              ? "No retained Control family is present."
              : "Choose one runtime-reported Control family.",
            stale: subject.stale || state.selectedDelivery?.generation !== binding.generation,
            level: "families" as const,
            recordKind: null,
            recordId: null,
            items: Object.freeze(result.value.families.map((family) => Object.freeze({
              id: family.recordKind,
              label: [
                family.recordKind,
                `records ${family.recordCount} · revisions ${family.revisionCount}`,
                `current ${family.current === null ? "none" : `${family.current.id} @ ${family.current.revision}`}`,
              ].join(" · "),
              detail: null,
            }))),
            selectedIndex: 0,
            bounded: false,
            exactBody: null,
          });
        } else if (selection.kind === "family") {
          if (result.value.kind !== "family" || result.value.recordKind !== selection.recordKind) {
            throw new Error("Completed Control read did not return the exact selected family");
          }
          const subject = controlInspectionSubject(binding, result.value.generation);
          modal = Object.freeze({
            kind: "control" as const,
            deliveryId: binding.deliveryId,
            generation: subject.generation,
            title: `Control records · ${selection.recordKind}`,
            body: result.value.records.length === 0
              ? "No retained record is present in this family."
              : "Choose one exact runtime-reported record identity.",
            stale: subject.stale || state.selectedDelivery?.generation !== binding.generation,
            level: "records" as const,
            recordKind: selection.recordKind,
            recordId: null,
            items: Object.freeze(result.value.records.map((record) => Object.freeze({
              id: record.recordId,
              label: `${record.recordId} · current revision ${record.revision} · ${record.digest}`,
              detail: null,
            }))),
            selectedIndex: 0,
            bounded: result.value.nextAfterRecordId !== null,
            exactBody: null,
          });
        } else {
          if (result.value.kind !== "revisions" || result.value.recordId !== selection.recordId) {
            throw new Error("Completed Control read did not return the exact selected record revisions");
          }
          const subject = controlInspectionSubject(binding, result.value.generation);
          let detailBounded = false;
          const items = result.value.records.map((record) => {
            const exact = tuiSafeText([
              "IDENTITY",
              `${record.recordKind} · ${record.recordId} · revision ${record.revision}`,
              `Digest: ${record.digest}`,
              `Created: ${record.createdAt}`,
              `Semantic authority: ${record.semanticAuthority}`,
              `Producer: ${tuiSafeJson(record.producer)}`,
              `Semantic author: ${tuiSafeJson(record.semanticAuthor)}`,
              "",
              "SEMANTIC MARKDOWN",
              record.semanticMarkdown,
              "",
              "TYPED PAYLOAD",
              JSON.stringify(record.payload, null, 2),
              "",
              "RELATIONSHIPS",
              JSON.stringify(record.relationships, null, 2),
            ].join("\n"), 128 * 1_024);
            detailBounded ||= !exact.complete;
            return Object.freeze({
              id: record.recordId,
              label: `revision ${record.revision} · ${record.createdAt} · ${record.digest}`,
              detail: `${exact.value}${exact.complete ? "" : "\n\n[exact revision display bounded]"}`,
            });
          });
          modal = Object.freeze({
            kind: "control" as const,
            deliveryId: binding.deliveryId,
            generation: subject.generation,
            title: `Control revisions · ${selection.recordId}`,
            body: items.length === 0
              ? "No retained revision is present for this record."
              : "Choose one exact runtime-reported revision.",
            stale: subject.stale || state.selectedDelivery?.generation !== binding.generation,
            level: "revisions" as const,
            recordKind: selection.recordKind,
            recordId: selection.recordId,
            items: Object.freeze(items),
            selectedIndex: 0,
            bounded: result.value.nextAfterRevision !== null || detailBounded,
            exactBody: null,
          });
        }
        release();
        dispatch({
          kind: "auxiliary-succeeded",
          sequence,
          modal,
        });
      }).catch((error: unknown) => {
        release();
        dispatch({ kind: "auxiliary-failed", sequence, message: lifecycleReadFailureMessage(error) });
      }).finally(release);
    };

    const startWatch = (): void => {
      if (watchActive !== null || exitRequested || state.freshness !== "live" || state.model === null) return;
      const binding = state.selectedDelivery;
      const inboxGeneration = state.model.kind === "inbox"
        ? state.model.inbox.generation
        : state.model.kind === "observed"
          ? state.model.inbox?.generation ?? null
          : null;
      const afterGeneration = binding?.generation ?? inboxGeneration;
      if (afterGeneration === null) return;
      const current: ActiveInvocation = { graceful: new AbortController(), force: new AbortController(), promise: Promise.resolve(), cancellationCount: 0 };
      watchActive = current;
      const release = (): void => { if (watchActive === current) watchActive = null; };
      current.promise = options.transport.watch(options.target, {
        scope: binding === null ? "inbox" : "delivery",
        deliveryId: binding?.deliveryId ?? null,
        afterGeneration,
        timeoutMs: Math.max(1, Math.min(60_000, options.refreshIntervalMs)),
      }, {
        signal: current.graceful.signal,
        forceSignal: current.force.signal,
        timeoutMs: Math.max(2_000, Math.min(70_000, options.refreshIntervalMs + 10_000)),
      }).then((result) => {
        if (result.operation !== "delivery.watch" || result.status !== "completed" ||
            result.value === null || !("kind" in result.value) || result.value.kind !== "watch") {
          throw new Error("Completed watch did not return one exact generation result");
        }
        const changed = result.value.changed;
        release();
        if (exitRequested) return;
        // A generation change can request a coherent refresh only when the
        // reducer is not protecting a foreground mutation or its post-result
        // inspection. The reducer intentionally drops this timer while such
        // an operation is pending; operation-succeeded then installs the
        // complete post-mutation snapshot and starts a fresh watch.
        if (changed) dispatch({ kind: "timer" });
        else startWatch();
      }).catch(() => {
        release();
        if (exitRequested || current.graceful.signal.aborted || current.force.signal.aborted) return;
        // Watch is only a change notification. Its failure cannot invalidate
        // or overwrite the last coherent snapshot; fall back to a full read.
        dispatch({ kind: "timer" });
      }).finally(release);
    };
    const applyEffects = (effects: readonly LifecycleTuiEffect[]): void => {
      for (const effect of effects) {
        if (effect.kind === "refresh") startRefresh(effect.sequence);
        else if (effect.kind === "prepare") startPrepare(effect.sequence, effect.input);
        else if (effect.kind === "execute-next-pass") {
          startNextPass(effect.sequence, effect.operation, effect.binding, effect.input);
        } else if (effect.kind === "load-diff") {
          startDiff(effect.sequence, effect.binding, effect.subject);
        } else if (effect.kind === "load-control") {
          startControl(effect.sequence, effect.binding, effect.selection);
        } else if (effect.kind === "cancel-refresh" || effect.kind === "cancel-prepare" ||
          effect.kind === "cancel-operation" || effect.kind === "cancel-auxiliary") cancelInvocation();
        else if (effect.kind === "replace-frame-draft") view?.replaceDraft(effect.value);
        else if (effect.kind === "replace-next-pass-draft") view?.replaceNextDraft(effect.value);
        else if (effect.kind === "select-inbox-delivery") {
          const inbox = state.model?.kind === "inbox"
            ? state.model.inbox
            : state.model?.kind === "observed"
              ? state.model.inbox
              : null;
          const selected = inbox?.rows[effect.index];
          if (selected?.status === "available") {
            const binding = Object.freeze({
              deliveryId: selected.deliveryId,
              generation: selected.generation.digest,
            });
            activeDeliveryId = selected.deliveryId;
            cancelWatch();
            dispatch({ kind: "delivery-selected", binding, index: effect.index });
            dispatch({ kind: "key", key: "refresh" });
          }
        }
        else if (effect.kind === "quit") beginQuit(effect.handoffActionIndex);
      }
    };
    const processEvent = (event: LifecycleTuiEvent<LifecycleTuiSnapshot>): void => {
      const updated = updateLifecycleTui(state, event);
      state = updated.state;
      applyEffects(updated.effects);
      if (!exitRequested) view?.render(state);
      if (event.kind === "refresh-succeeded" || event.kind === "prepare-succeeded" ||
          event.kind === "operation-succeeded") {
        const prior = watchActive;
        if (prior === null) startWatch();
        else {
          cancelWatch();
          void prior.promise.finally(() => startWatch());
        }
      }
    };
    const fail = (error: unknown): void => { if (fatal === null) fatal = error; beginQuit(null, 1); };
    dispatch = createOpenTuiEventDispatcher({ accept: () => !exitRequested, process: processEvent, fail });

    removeSignal = options.signals.useInteractiveHandler((code) => beginQuit(null, code));
    onRenderError = (event: unknown): void => fail(typeof event === "object" && event !== null && "error" in event ? (event as { error: unknown }).error : event);
    renderer.on(CliRenderEvents.RENDER_ERROR, onRenderError);
    renderer.on(CliRenderEvents.HANDLER_ERROR, onRenderError);
    view = new LifecycleOpenTuiView(renderer, options.target, state, {
      key: (key) => dispatch({ kind: "key", key }),
      draft: (value, normalization) => dispatch({
        kind: "frame-draft-changed",
        value,
        ...(normalization === undefined ? {} : { normalization }),
      }),
      nextDraft: (value, normalization) => dispatch({
        kind: "next-pass-draft-changed",
        value,
        ...(normalization === undefined ? {} : { normalization }),
      }),
      resize: (columns, rows) => dispatch({ kind: "resize", viewport: { columns, rows } }),
    });
    dispatch({ kind: "start" });
    await quitComplete;
    if (fatal !== null) throw fatal;
    return Object.freeze({ exitCode, selectedAction, snapshot: state.model });
  } finally {
    if (poll !== null) clearInterval(poll);
    if (quitForceTimer !== null) clearTimeout(quitForceTimer);
    removeSignal?.();
    if (onRenderError !== null) {
      renderer.off(CliRenderEvents.RENDER_ERROR, onRenderError);
      renderer.off(CliRenderEvents.HANDLER_ERROR, onRenderError);
    }
    const current = active as ActiveInvocation | null;
    if (current !== null) { current.force.abort(); await current.promise.catch(() => undefined); }
    const currentWatch = watchActive as ActiveInvocation | null;
    if (currentWatch !== null) {
      currentWatch.force.abort();
      await currentWatch.promise.catch(() => undefined);
    }
    await destroyOpenTuiSession(view, renderer);
  }
}
