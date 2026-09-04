import { resolve } from "node:path";

export type LifecycleTuiConfig = Readonly<{
  target: string;
  deliveryId: string | null;
  refreshIntervalMs: number;
  help: boolean;
}>;

const MINIMUM_REFRESH_MS = 500;
const MAXIMUM_REFRESH_MS = 60_000;

function takeValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires one value`);
  }
  return value;
}

export function parseLifecycleTuiConfig(
  args: readonly string[],
  options: Readonly<{ cwd?: string }> = {},
): LifecycleTuiConfig {
  let target = options.cwd ?? process.cwd();
  let deliveryId: string | null = null;
  let refreshIntervalMs = 2_000;
  let help = false;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!option.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${option}`);
    }
    if (seen.has(option)) {
      throw new Error(`Repeated option: ${option}`);
    }
    seen.add(option);
    switch (option) {
      case "--target":
        target = takeValue(args, index, option);
        index += 1;
        break;
      case "--delivery-id":
        deliveryId = takeValue(args, index, option);
        index += 1;
        break;
      case "--refresh-ms": {
        const raw = takeValue(args, index, option);
        index += 1;
        if (!/^[0-9]+$/u.test(raw)) {
          throw new Error("--refresh-ms must be a base-10 integer");
        }
        refreshIntervalMs = Number(raw);
        if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < MINIMUM_REFRESH_MS || refreshIntervalMs > MAXIMUM_REFRESH_MS) {
          throw new Error(`--refresh-ms must be between ${MINIMUM_REFRESH_MS} and ${MAXIMUM_REFRESH_MS}`);
        }
        break;
      }
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (target.includes("\u0000") || deliveryId?.includes("\u0000")) {
    throw new Error("Target paths and Delivery identities cannot contain NUL bytes");
  }

  return Object.freeze({
    target: resolve(options.cwd ?? process.cwd(), target),
    deliveryId,
    refreshIntervalMs,
    help,
  });
}

export const LIFECYCLE_TUI_USAGE = `Usage: lifecycle-tui [options]

Frame one complete brief through canonical CLI prepare, or hand a later course to that CLI.
The TUI uses the canonical lifecycle executable on PATH. OpenTUI loads only for an interactive TTY.

Options:
  --target <path>       Target repository (default: current directory)
  --delivery-id <id>    Exact existing Delivery identity for status and refresh
  --refresh-ms <ms>     Read-only status refresh interval (500-60000)
  --help                Show this help
`;
