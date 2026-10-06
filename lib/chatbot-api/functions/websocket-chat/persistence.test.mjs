import { describe, it, expect, vi } from "vitest";

const mockLambdaSend = vi.hoisted(() => vi.fn());

// Provided by the Lambda runtime, not installed at the repo root.
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(function () { return { send: vi.fn() }; }),
  PutItemCommand: vi.fn(function (i) { return i; }),
  GetItemCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(function () { return { send: mockLambdaSend }; }),
  InvokeCommand: vi.fn(function (i) { return i; }),
}));

import {
  sanitizeSourcesForStorage,
  buildStoredMetadata,
  MAX_STORED_SOURCES,
  MAX_STORED_METADATA_CHARS,
  parseHandlerReply,
  persistContextSummary,
  saveSessionEntry,
} from "./persistence.mjs";

const source = (n, extra = {}) => ({
  chunkIndex: n,
  title: `doc${n}.pdf`,
  uri: `https://bucket.s3.amazonaws.com/doc${n}.pdf?X-Amz-Security-Token=secret`,
  excerpt: "Some excerpt text.",
  score: 0.9,
  page: 3,
  s3Key: `doc${n}.pdf`,
  sourceType: "knowledgeBase",
  cited: true,
  ...extra,
});

describe("sanitizeSourcesForStorage", () => {
  it("drops the presigned uri and keeps the fields the UI needs", () => {
    const [out] = sanitizeSourcesForStorage([source(1, { unexpected: "x" })]);
    expect(out).toEqual({
      chunkIndex: 1, title: "doc1.pdf", s3Key: "doc1.pdf", page: 3,
      excerpt: "Some excerpt text.", score: 0.9, sourceType: "knowledgeBase", cited: true,
    });
  });

  it("does not mutate the live source objects", () => {
    const live = [source(1)];
    sanitizeSourcesForStorage(live);
    expect(live[0].uri).toContain("https://");
  });

  it("tolerates a non-array", () => {
    expect(sanitizeSourcesForStorage(undefined)).toEqual([]);
  });
});

describe("buildStoredMetadata", () => {
  const meta = (sources) => ({ Sources: sources, Trace: { messageId: "m1" }, ContextUsage: { percent: 5 } });

  it("keeps Trace and ContextUsage and strips uris", () => {
    const parsed = JSON.parse(buildStoredMetadata(meta([source(1)])));
    expect(parsed.Trace).toEqual({ messageId: "m1" });
    expect(parsed.ContextUsage).toEqual({ percent: 5 });
    expect(parsed.Sources[0].uri).toBeUndefined();
    expect(parsed.Sources[0].s3Key).toBe("doc1.pdf");
  });

  it("caps the number of stored sources", () => {
    const many = Array.from({ length: MAX_STORED_SOURCES + 30 }, (_, i) => source(i + 1));
    const parsed = JSON.parse(buildStoredMetadata(meta(many)));
    expect(parsed.Sources.length).toBeLessThanOrEqual(MAX_STORED_SOURCES);
  });

  it("stays under the size ceiling even with huge excerpts and titles", () => {
    const huge = Array.from({ length: 40 }, (_, i) =>
      source(i + 1, { excerpt: "e".repeat(5000), title: "t".repeat(2000) }));
    const json = buildStoredMetadata(meta(huge));
    expect(json.length).toBeLessThanOrEqual(MAX_STORED_METADATA_CHARS);
    expect(JSON.parse(json).Trace.messageId).toBe("m1");
  });
});

const reply = (statusCode, body) => ({ Payload: Buffer.from(JSON.stringify({ statusCode, body: JSON.stringify(body) })) });

describe("session-handler replies", () => {
  it("parseHandlerReply classifies success, error status, FunctionError and junk", () => {
    expect(parseHandlerReply(reply(200, { ok: 1 }))).toEqual({ failure: null, body: { ok: 1 } });
    expect(parseHandlerReply(reply(500, "db down")).failure).toMatchObject({ reason: "error_response", statusCode: 500 });
    expect(parseHandlerReply({ FunctionError: "Unhandled" }).failure.reason).toBe("function_error");
    expect(parseHandlerReply({ Payload: Buffer.from("not json") }).failure.reason).toBe("unparseable_response");
    expect(parseHandlerReply({})).toEqual({ failure: null, body: null });
  });

  it("persistContextSummary throws when the handler replies with an error status", async () => {
    mockLambdaSend.mockResolvedValueOnce(reply(500, "Failed"));
    await expect(persistContextSummary("u", "s", "summary")).rejects.toThrow(/Context summary save failed/);
    mockLambdaSend.mockResolvedValueOnce(reply(200, { updated: true }));
    await expect(persistContextSummary("u", "s", "summary")).resolves.toBeUndefined();
  });

  it("saveSessionEntry succeeds but warns when the handler trimmed old turns", async () => {
    mockLambdaSend.mockResolvedValueOnce(reply(200, { created: false, trimmed: true, removed_entries: 3 }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await saveSessionEntry({})).toBeNull();
      const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("trimmed"));
      expect(line).toContain('"level":"WARN"');
      expect(line).toContain('"removedEntries":3');
    } finally {
      logSpy.mockRestore();
    }
  });
});
