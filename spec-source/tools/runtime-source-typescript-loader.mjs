#!/usr/bin/env node

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const runtimeSourceRoot = `${pathToFileURL(resolve(toolDirectory, "../../runtime/src")).href}/`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(runtimeSourceRoot) === true &&
      specifier.startsWith(".") &&
      specifier.endsWith(".js")
    ) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { shortCircuit: true, url: candidate.href };
      }
    }
    return nextResolve(specifier, context);
  },
});
