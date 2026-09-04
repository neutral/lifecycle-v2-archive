import type { FoundationRuntimeObservation } from "@neutral/lifecycle-protocol";

export type FoundationTuiActivityView = Readonly<{
  value: Readonly<{
    id: string;
    operation: string;
    family: string;
    stage: string;
  }> | null;
}>;

/** Compact status activity only; the complete Attempt View comes from runtime inspection. */
export function foundationTuiActivityView(
  observation: FoundationRuntimeObservation,
): FoundationTuiActivityView {
  const activity = observation.delivery?.activities.at(-1) ?? null;
  return Object.freeze({
    value: activity === null
      ? null
      : Object.freeze({
          id: activity.id,
          operation: activity.operation,
          family: activity.family,
          stage: activity.stage,
        }),
  });
}
