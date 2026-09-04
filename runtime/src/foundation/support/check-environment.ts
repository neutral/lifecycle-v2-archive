const FOUNDATION_PROTECTED_CHECK_ENVIRONMENT_NAMES = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
]);

/**
 * A Check Binding cannot replace the six values constructed and owned by the
 * local runner. This is not a general environment denylist.
 */
export function protectedCheckEnvironmentName(name: string): boolean {
  return FOUNDATION_PROTECTED_CHECK_ENVIRONMENT_NAMES.has(name);
}
