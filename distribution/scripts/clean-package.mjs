#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distributionRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
await rm(resolve(distributionRoot, "package", "dist"), { force: true, recursive: true });
