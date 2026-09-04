/**
 * Compare strings by Unicode scalar-value sequence.
 *
 * JavaScript's default string comparison uses UTF-16 code units, so it does
 * not implement Lifecycle's code-point ordering for supplementary characters.
 */
export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

export function compareNullableCodePoints(left: string | null, right: string | null): number {
  return compareCodePoints(left ?? "", right ?? "");
}

export function sortUniqueCodePoints(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}
