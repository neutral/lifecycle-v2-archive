#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { asLifecycleError, LifecycleError } from "./errors.js";
import {
  closestSuggestion,
  contextualHelpCommand,
  resolveHelp,
  TOP_LEVEL_COMMANDS,
} from "./cli-help.js";
import {
  dispatchFoundationCli,
  isFoundationCliDispatch,
} from "./foundation/cli.js";
import { renderFoundationRuntimeHuman } from "./foundation/facade.js";
import {
  FOUNDATION_AUTHENTICATED_PUBLICATION_STATUS,
  FOUNDATION_SPECIFICATION_ID,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_SPECIFICATION_STATUS,
} from "./foundation/constants.js";
import { canonicalJsonLine } from "./foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "./foundation/validation/generated-schemas.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "./foundation/repository/contract.js";
import {
  isProcessCancellationError,
  throwIfProcessCancellationRequested,
  withProcessCancellation,
} from "./util/process.js";
import { CODEX_COMPATIBILITY, RUNTIME_PROTOCOL, RUNTIME_VERSION } from "./version.js";

async function readAuthoritySecretFile(path: string): Promise<string> {
  const absolute = resolve(path);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (currentUid !== null && metadata.uid !== currentUid)
    ) {
      throw new LifecycleError({
        code: "cli.authority-secret-file",
        message: "--authority-secret-file must name one owner-private regular file",
        observedFacts: { path: absolute },
      });
    }
    const maximum = 4_096;
    const buffer = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximum) {
      throw new LifecycleError({
        code: "cli.authority-secret-file",
        message: "--authority-secret-file exceeds the 4096-byte authority-secret bound",
        observedFacts: { path: absolute },
      });
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new LifecycleError({
        code: "cli.authority-secret-file",
        message: "--authority-secret-file must contain valid UTF-8 secret bytes",
        observedFacts: { path: absolute },
      });
    }
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError({
      code: "cli.authority-secret-file",
      message: "--authority-secret-file is unavailable",
      observedFacts: { path: absolute, cause: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function dispatch(args: readonly string[]): Promise<unknown> {
  const command = args[0];
  if (command === "version") {
    if (args.length !== 1) {
      throw new LifecycleError({ code: "cli.usage", message: "version accepts no arguments or options" });
    }
    return Object.freeze({
      runtimeVersion: RUNTIME_VERSION,
      runtimeProtocol: RUNTIME_PROTOCOL,
      specificationId: FOUNDATION_SPECIFICATION_ID,
      specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
      specificationStatus: FOUNDATION_SPECIFICATION_STATUS,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      authenticatedPublicationStatus: FOUNDATION_AUTHENTICATED_PUBLICATION_STATUS,
      provider: Object.freeze({
        defaultDescriptorId: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.id,
        defaultDescriptorDigest: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest,
        protocol: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.adapter.protocol,
      }),
      codex: CODEX_COMPATIBILITY,
    });
  }
  if (command !== undefined && command !== "version" && TOP_LEVEL_COMMANDS.includes(command as never)) {
    return await dispatchFoundationCli(args, { readAuthoritySecret: readAuthoritySecretFile });
  }
  const suggestion = command === undefined ? undefined : closestSuggestion(command, TOP_LEVEL_COMMANDS);
  throw new LifecycleError({
    code: "cli.usage",
    message: `Unknown command: ${command ?? "<none>"}.${suggestion ? ` Did you mean ${suggestion}?` : ""}`,
  });
}

function withCliRecovery(failure: LifecycleError, args: readonly string[]): LifecycleError {
  if (!failure.code.startsWith("cli.") || failure.recoveryActions.length > 0) return failure;
  const helpCommand = contextualHelpCommand(args);
  return new LifecycleError({
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    repositoryChanged: failure.repositoryChanged,
    operationalStateChanged: failure.operationalStateChanged,
    recoveryActions: [{
      action: helpCommand,
      detail: "Show the exact Foundation v1 command syntax without inspecting or changing the target.",
    }],
    observedFacts: failure.observedFacts,
  });
}

function isBrokenPipe(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EPIPE";
}

async function writeStream(stream: NodeJS.WriteStream, value: string): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      setImmediate(() => stream.removeListener("error", onError));
      if (error) rejectWrite(error);
      else resolveWrite();
    };
    const onError = (error: Error): void => finish(error);
    stream.once("error", onError);
    stream.write(value, finish);
  });
}

export type InterruptSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export function cliFailureExitCode(
  failure: LifecycleError,
  receivedSignal: InterruptSignal | null,
  forced: boolean,
): number {
  if (receivedSignal !== null && (isProcessCancellationError(failure) || forced)) {
    return { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[receivedSignal];
  }
  return failure.code.startsWith("cli.") ? 2 : 1;
}

export async function main(
  args = process.argv.slice(2),
  suppliedAuthoritySecret?: string,
  handoffBootstrapSignals?: () => readonly InterruptSignal[],
): Promise<void> {
  delete process.env.LIFECYCLE_AUTHORITY_SECRET;
  const controller = new AbortController();
  const forceController = new AbortController();
  const signalExitCode: Record<InterruptSignal, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  let receivedSignal: InterruptSignal | null = null;
  let forcedExitTimer: NodeJS.Timeout | undefined;
  const interrupt = (signal: InterruptSignal): void => {
    receivedSignal ??= signal;
    if (!controller.signal.aborted) controller.abort();
    else {
      forceController.abort();
      forcedExitTimer ??= setTimeout(() => process.exit(signalExitCode[receivedSignal!]), 1_000);
    }
  };
  const signalHandlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) => ({
    signal,
    handler: (): void => interrupt(signal),
  }));
  for (const { signal, handler } of signalHandlers) process.on(signal, handler);
  for (const signal of handoffBootstrapSignals?.() ?? []) interrupt(signal);
  try {
    const help = resolveHelp(args);
    if (help !== undefined) {
      throwIfProcessCancellationRequested(controller.signal);
      await writeStream(process.stdout, help);
      return;
    }
    const normalizedArgs = args.length === 1 && (args[0] === "--version" || args[0] === "-V")
      ? ["version"]
      : args;
    if (suppliedAuthoritySecret !== undefined) {
      throw new LifecycleError({
        code: "cli.option",
        message: "LIFECYCLE_AUTHORITY_SECRET is unavailable in Foundation v1; use --authority-secret-file",
      });
    }
    if (controller.signal.aborted) {
      throw new LifecycleError({
        code: "runtime.interrupted",
        message: "Lifecycle was interrupted before the operation started",
        retryable: true,
      });
    }
    const result = await withProcessCancellation(
      { signal: controller.signal, forceSignal: forceController.signal },
      async () => await dispatch(normalizedArgs),
    );
    const rendered = isFoundationCliDispatch(result)
      ? result.format === "human"
        ? renderFoundationRuntimeHuman(result.result)
        : canonicalJsonLine(result.result)
      : canonicalJsonLine(result);
    await writeStream(process.stdout, rendered);
  } catch (error) {
    if (isBrokenPipe(error)) {
      process.exitCode = 0;
      return;
    }
    const failure = withCliRecovery(asLifecycleError(error), args);
    process.exitCode = cliFailureExitCode(failure, receivedSignal, forceController.signal.aborted);
    try {
      await writeStream(process.stderr, canonicalJsonLine({ error: failure.toJSON() }));
    } catch (writeError) {
      if (!isBrokenPipe(writeError)) throw writeError;
    }
  } finally {
    if (forcedExitTimer) clearTimeout(forcedExitTimer);
    for (const { signal, handler } of signalHandlers) process.removeListener(signal, handler);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
