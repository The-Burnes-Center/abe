import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Every Node Lambda must run in whatever region the stack is deployed to.
// A hardcoded region silently breaks presigned URLs (signed for the wrong
// region) and cross-region calls in any other deployment.
const FUNCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function listNodeSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listNodeSources(full));
    } else if (/\.(mjs|js)$/.test(name) && !/\.test\.mjs$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Node Lambda sources are region-agnostic", () => {
  it("never hardcode an AWS region", () => {
    const offenders = listNodeSources(FUNCTIONS_DIR)
      .filter((file) => /["'`](us|eu|ap|ca|sa|me|af)-[a-z]+-\d["'`]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
