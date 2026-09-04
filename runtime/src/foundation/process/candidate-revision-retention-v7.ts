import {
  finalizeCandidateRevisionRetention,
  type PreparedCandidateRevisionRetention,
  type RetainedCandidateRevision,
} from "../control/candidate-revision.js";
import type {
  ControlJsonObject,
  ControlRecordOperationSupportCoordinate,
} from "../control/types.js";
import type {
  FoundationActivityKernelCheckpointAdapterV7,
  FoundationActivityKernelContextV7,
} from "./activity-kernel-v7.js";

/**
 * Atomically promote one already verified Candidate Revision through its
 * owning Activity support generation. Candidate preparation owns semantic
 * compilation; the Activity kernel owns the file, Journal, and recovery
 * checkpoint transaction.
 */
export async function commitPreparedCandidateRevisionThroughActivityV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  activity: FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint>;
  expected: ControlRecordOperationSupportCoordinate;
  checkpoint: ControlJsonObject | null;
  prepared: PreparedCandidateRevisionRetention;
}>): Promise<Readonly<{
  context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
  retained: RetainedCandidateRevision;
}>> {
  const committed = await input.activity.commitWithFiles({
    expected: input.expected,
    checkpoint: input.checkpoint,
    append: input.prepared.append,
    files: input.prepared.files,
  });
  return Object.freeze({
    context: committed.context,
    retained: finalizeCandidateRevisionRetention(input.prepared, {
      append: committed.append,
      files: committed.files,
    }),
  });
}
