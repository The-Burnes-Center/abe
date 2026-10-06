import { describe, it, expect, vi } from "vitest";

vi.mock("./kb.mjs", () => ({ retrieveKBDocs: vi.fn(), retrieveFullDocument: vi.fn() }));
vi.mock("./tools.mjs", () => ({
  truncate: (s) => s,
  capToolResultSize: (s) => s,
  fetchMetadata: vi.fn(),
  enrichExcelIndexResult: vi.fn(),
  invokeIndexQuery: vi.fn(),
  EXCEL_DEFAULT_LIMIT: 50,
}));

import { runToolCalls, buildAssistantToolMessage, toolResultsMessage } from "./tool-runner.mjs";

const ctx = () => ({
  knowledgeBase: {}, kbId: "kb", indexes: [],
  state: { sources: [], documentIndexMap: [] },
  sendStatus: vi.fn(async () => {}),
});

describe("runToolCalls", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "no_such_tool"])(
    "treats %s as an unknown tool instead of calling an inherited property",
    async (name) => {
      const [result] = await runToolCalls([{ id: "t1", name, parsedInput: {} }], ctx());
      expect(result).toEqual({ toolId: "t1", content: "Unknown tool requested.", documentBlocks: [] });
    }
  );

  it("reports unparseable input back to the model", async () => {
    const [result] = await runToolCalls([{ id: "t1", name: "query_db", parsedInput: null }], ctx());
    expect(result.content).toContain("could not be parsed");
  });
});

describe("message builders", () => {
  it("buildAssistantToolMessage keeps pre-tool text and marks bad JSON", () => {
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { message, calls } = buildAssistantToolMessage(
      [{ id: "a", name: "query_db", inputJson: '{"query":"x"}' }, { id: "b", name: "query_db", inputJson: "{bad" }],
      "Let me check."
    );
    errSpy.mockRestore();
    expect(message.content[0]).toEqual({ type: "text", text: "Let me check." });
    expect(message.content[2].input).toEqual({});
    expect(calls.map((c) => c.parsedInput)).toEqual([{ query: "x" }, null]);
  });

  it("toolResultsMessage puts tool_result blocks before document blocks", () => {
    const doc = { type: "document", title: "Source 1 - a.pdf" };
    const msg = toolResultsMessage([
      { toolId: "a", content: "one", documentBlocks: [doc] },
      { toolId: "b", content: "two", documentBlocks: [] },
    ]);
    expect(msg.content.map((b) => b.type)).toEqual(["tool_result", "tool_result", "document"]);
  });
});
