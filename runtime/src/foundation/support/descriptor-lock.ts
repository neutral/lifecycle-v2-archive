export const FOUNDATION_DESCRIPTOR_LOCK_CHILD_FD = 3;

export type FoundationDescriptorLockProvider = Readonly<{
  executable: string;
  arguments: readonly string[];
  contentionExitCode: number;
}>;

/** Select the descriptor-lock utility owned by one supported Runtime host. */
export function foundationDescriptorLockProvider(
  platform: NodeJS.Platform = process.platform,
): FoundationDescriptorLockProvider | null {
  if (platform === "darwin") {
    return Object.freeze({
      executable: "/usr/bin/lockf",
      arguments: Object.freeze([
        "-s",
        "-t",
        "0",
        String(FOUNDATION_DESCRIPTOR_LOCK_CHILD_FD),
      ]),
      contentionExitCode: 75,
    });
  }
  if (platform === "linux") {
    return Object.freeze({
      executable: "/usr/bin/flock",
      arguments: Object.freeze([
        "-x",
        "-n",
        "-E",
        "75",
        String(FOUNDATION_DESCRIPTOR_LOCK_CHILD_FD),
      ]),
      contentionExitCode: 75,
    });
  }
  return null;
}
