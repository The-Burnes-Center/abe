import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(function () { return { send: mockDdbSend }; }),
  GetItemCommand: vi.fn(function (i) { return { ...i, __cmd: "GetItem" }; }),
  PutItemCommand: vi.fn(function (i) { return { ...i, __cmd: "PutItem" }; }),
}));

const BASE = "You are {{assistant_name}} for {{organization}}.";

/** Fresh module per test so the in-memory hash cache never leaks between tests. */
async function loadModule() {
  vi.resetModules();
  return import("./prompt-registry.mjs");
}

/** Route GetItem calls by VersionId to canned items. */
function registryWith(itemsByVersion) {
  mockDdbSend.mockImplementation(async (cmd) => {
    if (cmd.__cmd === "PutItem") return {};
    const versionId = cmd.Key.VersionId.S;
    return { Item: itemsByVersion[versionId] };
  });
}

function versionRow(template, createdBy) {
  return {
    ItemType: { S: "PromptVersion" },
    Template: { S: template },
    CreatedBy: { S: createdBy },
    TemplateHash: { S: "stale" },
  };
}

const ENV_KEYS = ["PROMPT_REGISTRY_TABLE", "ASSISTANT_NAME", "ORGANIZATION_NAME", "ORGANIZATION"];
const savedEnv = {};

beforeEach(() => {
  mockDdbSend.mockReset();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.PROMPT_REGISTRY_TABLE = "registry";
  process.env.ASSISTANT_NAME = "Helper";
  process.env.ORGANIZATION_NAME = "Acme";
  delete process.env.ORGANIZATION;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("loadRenderedPrompt", () => {
  it("falls back to the embedded default when the registry read fails", async () => {
    mockDdbSend.mockRejectedValue(Object.assign(new Error("AccessDenied"), { name: "AccessDeniedException" }));
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { loadRenderedPrompt } = await loadModule();

    const result = await loadRenderedPrompt(BASE, "Monday");

    expect(result.promptVersionId).toBe("embedded-default");
    expect(result.promptText).toContain("You are Helper for Acme.");
    expect(result.promptText).toContain("Today is Monday.");
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"level":"ERROR"');
    expect(logged).toContain("Prompt registry read failed");
    errSpy.mockRestore();
  });

  it("renders the date argument as a string, not an object", async () => {
    delete process.env.PROMPT_REGISTRY_TABLE;
    const { loadRenderedPrompt } = await loadModule();
    const result = await loadRenderedPrompt(BASE, "Tuesday, October 6, 2026");
    expect(result.promptText).toContain("Today is Tuesday, October 6, 2026.");
    expect(result.promptText).not.toContain("[object Object]");
  });

  it("still reads the legacy ORGANIZATION env var", async () => {
    delete process.env.PROMPT_REGISTRY_TABLE;
    delete process.env.ORGANIZATION_NAME;
    process.env.ORGANIZATION = "Legacy Org";
    const { loadRenderedPrompt } = await loadModule();
    const result = await loadRenderedPrompt(BASE, "Monday");
    expect(result.promptText).toContain("for Legacy Org.");
  });

  it("serves an admin-authored LIVE version", async () => {
    registryWith({
      "system-default": versionRow("old default", "system"),
      LIVE: { ActiveVersionId: { S: "v-admin" } },
      "v-admin": versionRow("Admin prompt for {{organization}}", "admin@example.com"),
    });
    const { loadRenderedPrompt } = await loadModule();
    const result = await loadRenderedPrompt(BASE, "Monday");
    expect(result.promptVersionId).toBe("v-admin");
    expect(result.promptText).toBe("Admin prompt for Acme");
  });
});

describe("loadRenderedPrompt readOnly (evaluation)", () => {
  it("never writes to the registry", async () => {
    registryWith({
      LIVE: { ActiveVersionId: { S: "v-admin" } },
      "v-admin": versionRow("Admin prompt", "admin@example.com"),
    });
    const { loadRenderedPrompt } = await loadModule();

    const result = await loadRenderedPrompt(BASE, "Monday", { readOnly: true });

    expect(result.promptVersionId).toBe("v-admin");
    const writes = mockDdbSend.mock.calls.filter(([cmd]) => cmd.__cmd === "PutItem");
    expect(writes).toEqual([]);
  });

  it("serves the code default when LIVE points at a system-owned row", async () => {
    registryWith({
      LIVE: { ActiveVersionId: { S: "system-default" } },
      "system-default": versionRow("stale prompt from an older deploy", "system"),
    });
    const { loadRenderedPrompt } = await loadModule();

    const result = await loadRenderedPrompt(BASE, "Monday", { readOnly: true });

    expect(result.promptVersionId).toBe("system-default");
    expect(result.promptText).toContain("You are Helper for Acme.");
    expect(mockDdbSend.mock.calls.some(([cmd]) => cmd.__cmd === "PutItem")).toBe(false);
  });

  it("the default (chat) path does sync the system default", async () => {
    registryWith({ LIVE: undefined, "system-default": undefined });
    const { loadRenderedPrompt } = await loadModule();
    await loadRenderedPrompt(BASE, "Monday");
    expect(mockDdbSend.mock.calls.some(([cmd]) => cmd.__cmd === "PutItem")).toBe(true);
  });
});
