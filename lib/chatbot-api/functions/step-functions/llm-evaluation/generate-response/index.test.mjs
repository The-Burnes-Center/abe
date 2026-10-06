import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => ({
  BedrockAgentRuntimeClient: vi.fn(function () { return { send: vi.fn() }; }),
  RetrieveCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(function () { return { send: vi.fn() }; }),
  QueryCommand: vi.fn(function (i) { return i; }),
  GetItemCommand: vi.fn(function (i) { return i; }),
  PutItemCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(function () { return { send: vi.fn() }; }),
  InvokeCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("./chat/models/chat-model.mjs", () => ({ default: vi.fn() }));
vi.mock("./chat/kb.mjs", () => ({
  retrieveKBDocs: vi.fn(),
  retrieveFullDocument: vi.fn(),
}));
vi.mock("./chat/tools.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  getAllTools: vi.fn(async () => ({ tools: [{ name: "query_db" }], indexes: [] })),
  constructSysPrompt: vi.fn(async () => ({ promptText: "PROD PROMPT", promptVersionId: "v-live", promptTemplateHash: "h" })),
}));

import ClaudeModel from "./chat/models/chat-model.mjs";
import { retrieveKBDocs } from "./chat/kb.mjs";
import { constructSysPrompt, getAllTools } from "./chat/tools.mjs";
import { handler } from "./index.mjs";

const ev = (obj) => ({ chunk: { bytes: new TextEncoder().encode(JSON.stringify(obj)) } });
async function* stream(events) { for (const e of events) yield e; }

const toolUseTurn = (id) => [
  ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "query_db" } }),
  ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"leave policy"}' } }),
  ev({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
];
const answerTurn = (text) => [
  ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
  ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
];

function parseChunk(chunk) {
  if (chunk.type === "content_block_delta") {
    if (chunk.delta.type === "text_delta") return { kind: "text", text: chunk.delta.text, index: chunk.index };
    if (chunk.delta.type === "input_json_delta") return { kind: "tool_input", json: chunk.delta.partial_json, index: chunk.index };
  } else if (chunk.type === "content_block_start" && chunk.content_block.type === "tool_use") {
    return { ...chunk.content_block, index: chunk.index };
  } else if (chunk.type === "message_delta") {
    return chunk.delta;
  }
  return null;
}

function setupModel(turns) {
  const model = {
    assembleHistory: vi.fn((hist, prompt) => [{ role: "user", content: [{ type: "text", text: prompt }] }]),
    parseChunk: vi.fn(parseChunk),
    getStreamedResponse: vi.fn(),
  };
  for (const t of turns) model.getStreamedResponse.mockImplementationOnce(() => stream(t));
  ClaudeModel.mockImplementation(function () { return model; });
  return model;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KB_ID = "kb";
  process.env.RETRY_BASE_DELAY_MS = "0";
  retrieveKBDocs.mockResolvedValue({
    content: "",
    sources: [{ chunkIndex: 1, title: "leave.pdf", uri: "https://signed?X-Amz-Security-Token=t", s3Key: "leave.pdf", sourceType: "knowledgeBase" }],
    documentBlocks: [{ type: "document", title: "Source 1 - leave.pdf", context: "Page 2, relevance score 1.4", source: { type: "text", data: "Staff get 20 days of leave." } }],
  });
});

afterEach(() => {
  delete process.env.MAX_TOOL_ROUNDS;
});

describe("generate-response (evaluation)", () => {
  it("runs the production tool loop with the read-only LIVE chat prompt", async () => {
    const model = setupModel([toolUseTurn("t1"), answerTurn("Staff get 20 days.")]);

    const res = await handler({ userMessage: "How much leave do staff get?", chatHistory: [] });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(constructSysPrompt).toHaveBeenCalledWith({ readOnly: true });
    expect(getAllTools).toHaveBeenCalled();
    expect(model.getStreamedResponse.mock.calls[0][0]).toBe("PROD PROMPT");
    expect(model.getStreamedResponse.mock.calls[0][2]).toEqual([{ name: "query_db" }]);
    expect(retrieveKBDocs).toHaveBeenCalledWith("leave policy", expect.anything(), "kb", 0, { withinDocument: null });
    expect(body.modelResponse).toBe("Staff get 20 days.");
    expect(body.context).toContain("Staff get 20 days of leave.");
    expect(body.promptVersionId).toBe("v-live");
    expect(body.toolRounds).toBe(1);
    expect(JSON.stringify(body.sources)).not.toContain("X-Amz-Security-Token");
  });

  it("stops at the tool-round cap", async () => {
    process.env.MAX_TOOL_ROUNDS = "2";
    const model = setupModel([toolUseTurn("a"), toolUseTurn("b"), toolUseTurn("c"), toolUseTurn("d")]);

    const body = JSON.parse((await handler({ userMessage: "Loop forever" })).body);

    expect(model.getStreamedResponse).toHaveBeenCalledTimes(3);
    expect(body.modelResponse).toContain("tool-round limit");
    expect(body.toolRounds).toBe(2);
  });

  it("retries a throttled model call", async () => {
    const model = setupModel([]);
    model.getStreamedResponse
      .mockRejectedValueOnce(Object.assign(new Error("slow down"), { name: "ThrottlingException" }))
      .mockImplementationOnce(() => stream(answerTurn("ok")));

    const body = JSON.parse((await handler({ userMessage: "q" })).body);

    expect(body.modelResponse).toBe("ok");
    expect(model.getStreamedResponse).toHaveBeenCalledTimes(2);
  });

  it("never logs the question or the answer", async () => {
    setupModel([toolUseTurn("t1"), answerTurn("SECRET-ANSWER-TEXT")]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handler({ userMessage: "SECRET-QUESTION-TEXT" });
      const logged = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain("SECRET-QUESTION-TEXT");
      expect(logged).not.toContain("SECRET-ANSWER-TEXT");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("get_context_only returns formatted query_db chunks", async () => {
    const body = JSON.parse((await handler({ userMessage: "leave", get_context_only: true })).body);
    expect(body.context).toContain("Source: leave.pdf");
    expect(body.context).toContain("Staff get 20 days of leave.");
    expect(body.sources[0].uri).toBeUndefined();
  });

  it("rejects a missing question with 400 and hides internal errors", async () => {
    expect((await handler({})).statusCode).toBe(400);
    const model = setupModel([]);
    model.getStreamedResponse.mockRejectedValue(new Error("arn:aws:secret"));
    const res = await handler({ userMessage: "q" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("arn:aws");
  });
});
