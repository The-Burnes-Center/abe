import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist the mock function so vi.mock() factory can reference it
const mockS3Send = vi.hoisted(() => vi.fn());

// vitest 4 requires constructor mocks (S3Client + commands, `new`-ed in kb.mjs)
// to be `function`/`class`, not arrows. getSignedUrl is a plain call, so it
// stays an arrow.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: mockS3Send }; }),
  GetObjectCommand: vi.fn(function (input) { return input; }),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(() => Promise.resolve("https://signed.url/test")),
}));

// kb.mjs imports this for retrieveKBDocs/retrieveFullDocument but not for the
// functions under test; mock it so the module can be loaded in the test runner.
vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => ({
  RetrieveCommand: vi.fn(function (i) { return i; }),
}));

import {
  getMetadataKeys,
  resolveDocumentName,
  METADATA_KEYS_TTL,
  metadataTxtUri,
  buildKbFilter,
  isMetadataTxtResult,
  retrieveKBDocs,
  retrieveFullDocument,
  hasTextContent,
  MAX_FULL_DOC_CHARS,
  MAX_FULL_DOC_CHUNKS,
  MAX_FULL_DOC_PAGES,
} from "./kb.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake S3 GetObject response whose body is a metadata.txt JSON object. */
function s3BodyFor(keys) {
  const obj = Object.fromEntries(keys.map(k => [k, { tags: [], summary: "" }]));
  return { Body: { transformToString: () => Promise.resolve(JSON.stringify(obj)) } };
}

/**
 * Advance the module-level cache epoch by 2× TTL before each test so that
 * any cache populated by a previous test is guaranteed to be expired.
 */
let epoch = 1_000_000;

// Save/restore KNOWLEDGE_BUCKET so env mutations in these tests never leak
// into other suites.
const ORIGINAL_KNOWLEDGE_BUCKET = process.env.KNOWLEDGE_BUCKET;

beforeEach(() => {
  mockS3Send.mockReset();
  vi.useFakeTimers();
  epoch += METADATA_KEYS_TTL * 5; // 5× ensures cache is expired even after tests that advance to epoch+TTL+1
  vi.setSystemTime(epoch);
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_KNOWLEDGE_BUCKET === undefined) {
    delete process.env.KNOWLEDGE_BUCKET;
  } else {
    process.env.KNOWLEDGE_BUCKET = ORIGINAL_KNOWLEDGE_BUCKET;
  }
});

// ---------------------------------------------------------------------------
// getMetadataKeys
// ---------------------------------------------------------------------------

describe("getMetadataKeys", () => {
  it("fetches keys from S3 on first call", async () => {
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115.pdf", "POL111.pdf"]));
    const keys = await getMetadataKeys();
    expect(keys).toEqual(["POL115.pdf", "POL111.pdf"]);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it("returns cached result within TTL without re-fetching S3", async () => {
    mockS3Send.mockResolvedValue(s3BodyFor(["doc1.pdf"]));
    await getMetadataKeys();                            // populates cache at `epoch`
    vi.setSystemTime(epoch + METADATA_KEYS_TTL / 2);   // still within TTL
    await getMetadataKeys();                            // should hit cache
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it("re-fetches from S3 after TTL expires", async () => {
    mockS3Send.mockResolvedValue(s3BodyFor(["doc1.pdf"]));
    await getMetadataKeys();
    vi.setSystemTime(epoch + METADATA_KEYS_TTL + 1);   // past TTL
    await getMetadataKeys();
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("returns null when S3 fetch fails", async () => {
    mockS3Send.mockRejectedValueOnce(new Error("AccessDenied"));
    const keys = await getMetadataKeys();
    expect(keys).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveDocumentName
// ---------------------------------------------------------------------------

describe("resolveDocumentName", () => {
  it("returns exact match (case-insensitive)", async () => {
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115.pdf", "POL111.pdf"]));
    expect(await resolveDocumentName("pol115.pdf")).toBe("POL115.pdf");
  });

  it("returns fuzzy match when no exact match exists", async () => {
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115 Guide.pdf", "POL111.pdf"]));
    expect(await resolveDocumentName("POL115")).toBe("POL115 Guide.pdf");
  });

  it("exact match takes priority over fuzzy match", async () => {
    // Both "POL115.pdf" and "POL115 Amendment.pdf" contain "pol115" as a substring;
    // exact match on "POL115.pdf" must win.
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115.pdf", "POL115 Amendment.pdf"]));
    expect(await resolveDocumentName("POL115.pdf")).toBe("POL115.pdf");
  });

  it("returns original name when no match found in keys", async () => {
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115.pdf", "POL111.pdf"]));
    expect(await resolveDocumentName("UNKNOWN.pdf")).toBe("UNKNOWN.pdf");
  });

  it("returns original name when S3 fetch fails (null keys)", async () => {
    mockS3Send.mockRejectedValueOnce(new Error("S3 error"));
    expect(await resolveDocumentName("doc.pdf")).toBe("doc.pdf");
  });

  it("skips metadata.txt in the fuzzy pass ('data' resolves to a real doc)", async () => {
    // "metadata.txt" contains "data" as a substring and is listed first, so
    // without the skip it would hijack the fuzzy match.
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["metadata.txt", "Data Services Guide.pdf"]));
    expect(await resolveDocumentName("data")).toBe("Data Services Guide.pdf");
  });

  it("still resolves an explicit exact request for metadata.txt", async () => {
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["metadata.txt", "Data Services Guide.pdf"]));
    expect(await resolveDocumentName("metadata.txt")).toBe("metadata.txt");
  });
});

// ---------------------------------------------------------------------------
// metadataTxtUri / buildKbFilter
// ---------------------------------------------------------------------------

describe("metadataTxtUri", () => {
  it("returns the full S3 URI when KNOWLEDGE_BUCKET is set", () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    expect(metadataTxtUri()).toBe("s3://test-bucket/metadata.txt");
  });

  it("returns null when KNOWLEDGE_BUCKET is unset", () => {
    delete process.env.KNOWLEDGE_BUCKET;
    expect(metadataTxtUri()).toBeNull();
  });
});

describe("buildKbFilter", () => {
  it("returns undefined when env is unset and no withinDocument", () => {
    delete process.env.KNOWLEDGE_BUCKET;
    expect(buildKbFilter({})).toBeUndefined();
    expect(buildKbFilter()).toBeUndefined();
  });

  it("returns a bare notEquals exclusion when env is set", () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    expect(buildKbFilter({})).toEqual({
      notEquals: {
        key: "x-amz-bedrock-kb-source-uri",
        value: "s3://test-bucket/metadata.txt",
      },
    });
  });

  it("returns andAll with exactly 2 members when env set + withinDocument", () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const filter = buildKbFilter({ withinDocument: "POL115 Guide.pdf" });
    expect(filter.andAll).toHaveLength(2);
    expect(filter).toEqual({
      andAll: [
        { stringContains: { key: "x-amz-bedrock-kb-source-uri", value: "POL115 Guide.pdf" } },
        { notEquals: { key: "x-amz-bedrock-kb-source-uri", value: "s3://test-bucket/metadata.txt" } },
      ],
    });
  });

  it("returns a bare stringContains when env unset + withinDocument", () => {
    delete process.env.KNOWLEDGE_BUCKET;
    expect(buildKbFilter({ withinDocument: "POL115 Guide.pdf" })).toEqual({
      stringContains: { key: "x-amz-bedrock-kb-source-uri", value: "POL115 Guide.pdf" },
    });
  });

  it("ignores an empty withinDocument string", () => {
    delete process.env.KNOWLEDGE_BUCKET;
    expect(buildKbFilter({ withinDocument: "" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isMetadataTxtResult
// ---------------------------------------------------------------------------

describe("isMetadataTxtResult", () => {
  it("returns true for a uri whose basename is metadata.txt", () => {
    expect(isMetadataTxtResult({
      location: { s3Location: { uri: "s3://bucket/metadata.txt" } },
    })).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isMetadataTxtResult({
      location: { s3Location: { uri: "s3://bucket/METADATA.TXT" } },
    })).toBe(true);
  });

  it("returns false for other files, including names containing 'metadata'", () => {
    expect(isMetadataTxtResult({
      location: { s3Location: { uri: "s3://bucket/POL115 Guide.pdf" } },
    })).toBe(false);
    expect(isMetadataTxtResult({
      location: { s3Location: { uri: "s3://bucket/records-metadata-guide.pdf" } },
    })).toBe(false);
    expect(isMetadataTxtResult({
      location: { s3Location: { uri: "s3://bucket/old-metadata.txt.pdf" } },
    })).toBe(false);
  });

  it("returns false when location is missing", () => {
    expect(isMetadataTxtResult({})).toBe(false);
    expect(isMetadataTxtResult(undefined)).toBe(false);
    expect(isMetadataTxtResult({ location: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// retrieveKBDocs
// ---------------------------------------------------------------------------

/** Build a fake Bedrock retrieval result item. */
function kbResult(uri, score, text = "chunk text") {
  return {
    score,
    content: { text },
    location: { s3Location: { uri } },
    metadata: { "x-amz-bedrock-kb-document-page-number": 1 },
  };
}

describe("retrieveKBDocs", () => {
  /** Fake BedrockAgentRuntimeClient: send() resolves with the given pages in order. */
  function fakeKbClient(...responses) {
    const send = vi.fn();
    for (const r of responses) send.mockResolvedValueOnce(r);
    return { send };
  }

  it("passes the metadata.txt exclusion filter to the Retrieve call when env is set", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const kb = fakeKbClient({ retrievalResults: [kbResult("s3://test-bucket/doc.pdf", 1.4)] });
    await retrieveKBDocs("query", kb, "KBID");
    // The RetrieveCommand mock returns its input, so send() receives the raw input
    const sentInput = kb.send.mock.calls[0][0];
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.filter).toEqual({
      notEquals: { key: "x-amz-bedrock-kb-source-uri", value: "s3://test-bucket/metadata.txt" },
    });
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.numberOfResults).toBe(25);
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.overrideSearchType).toBe("HYBRID");
  });

  it("omits the filter key when KNOWLEDGE_BUCKET is unset", async () => {
    delete process.env.KNOWLEDGE_BUCKET;
    const kb = fakeKbClient({ retrievalResults: [kbResult("s3://b/doc.pdf", 1.4)] });
    await retrieveKBDocs("query", kb, "KBID");
    const sentInput = kb.send.mock.calls[0][0];
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration).not.toHaveProperty("filter");
  });

  it("post-filters metadata.txt chunks out of the results", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const kb = fakeKbClient({
      retrievalResults: [
        kbResult("s3://test-bucket/metadata.txt", 1.6, "inventory blob"),
        kbResult("s3://test-bucket/POL115 Guide.pdf", 1.4),
      ],
    });
    const result = await retrieveKBDocs("query", kb, "KBID");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].title).toBe("POL115 Guide.pdf");
    expect(result.documentBlocks).toHaveLength(1);
    expect(result.documentBlocks[0].title).not.toContain("metadata.txt");
  });

  it("retains low-scoring results (no 0.6 threshold — hybrid scores aren't 0-1)", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const kb = fakeKbClient({
      retrievalResults: [kbResult("s3://test-bucket/doc.pdf", 0.4)],
    });
    const result = await retrieveKBDocs("query", kb, "KBID");
    expect(result.sources).toHaveLength(1);
    expect(result.content).toBe(""); // not the "No knowledge available" fallback
  });

  it("still caps a single document at PER_DOC_CAP (5) chunks", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const sameDoc = Array.from({ length: 7 }, (_, i) =>
      kbResult("s3://test-bucket/big.pdf", 1.6 - i * 0.01, `chunk ${i}`));
    const kb = fakeKbClient({
      retrievalResults: [...sameDoc, kbResult("s3://test-bucket/other.pdf", 1.3)],
    });
    const result = await retrieveKBDocs("query", kb, "KBID");
    const bigChunks = result.sources.filter(s => s.title === "big.pdf");
    expect(bigChunks).toHaveLength(5);
    expect(result.sources.filter(s => s.title === "other.pdf")).toHaveLength(1);
  });

  it("returns the no-knowledge fallback when only metadata.txt chunks come back", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const kb = fakeKbClient({
      retrievalResults: [kbResult("s3://test-bucket/metadata.txt", 1.6)],
    });
    const result = await retrieveKBDocs("query", kb, "KBID");
    expect(result.content).toContain("No knowledge available");
    expect(result.sources).toEqual([]);
    expect(result.documentBlocks).toEqual([]);
  });

  it("scopes the Retrieve filter to the resolved within_document (andAll when env set)", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    // metadata.txt body feeds resolveDocumentName ("POL115" → "POL115 Guide.pdf")
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115 Guide.pdf", "POL111.pdf"]));
    const kb = fakeKbClient({
      retrievalResults: [kbResult("s3://test-bucket/POL115 Guide.pdf", 1.4)],
    });
    await retrieveKBDocs("pricing terms", kb, "KBID", 0, { withinDocument: "POL115" });
    const sentInput = kb.send.mock.calls[0][0];
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.filter).toEqual({
      andAll: [
        { stringContains: { key: "x-amz-bedrock-kb-source-uri", value: "POL115 Guide.pdf" } },
        { notEquals: { key: "x-amz-bedrock-kb-source-uri", value: "s3://test-bucket/metadata.txt" } },
      ],
    });
  });

  it("scopes with a bare stringContains when KNOWLEDGE_BUCKET is unset", async () => {
    delete process.env.KNOWLEDGE_BUCKET;
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115 Guide.pdf"]));
    const kb = fakeKbClient({
      retrievalResults: [kbResult("s3://b/POL115 Guide.pdf", 1.4)],
    });
    await retrieveKBDocs("pricing terms", kb, "KBID", 0, { withinDocument: "POL115" });
    const sentInput = kb.send.mock.calls[0][0];
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.filter).toEqual({
      stringContains: { key: "x-amz-bedrock-kb-source-uri", value: "POL115 Guide.pdf" },
    });
  });

  it("falls back to the raw within_document string when resolution fails", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    // Inventory has no match for "UNKNOWN-99" → resolveDocumentName returns the input
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115 Guide.pdf"]));
    const kb = fakeKbClient({
      retrievalResults: [kbResult("s3://test-bucket/UNKNOWN-99 addendum.pdf", 1.2)],
    });
    await retrieveKBDocs("terms", kb, "KBID", 0, { withinDocument: "UNKNOWN-99" });
    const sentInput = kb.send.mock.calls[0][0];
    expect(sentInput.retrievalConfiguration.vectorSearchConfiguration.filter).toEqual({
      andAll: [
        { stringContains: { key: "x-amz-bedrock-kb-source-uri", value: "UNKNOWN-99" } },
        { notEquals: { key: "x-amz-bedrock-kb-source-uri", value: "s3://test-bucket/metadata.txt" } },
      ],
    });
  });

  it("returns retry guidance when a scoped search yields zero results", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    mockS3Send.mockResolvedValueOnce(s3BodyFor(["POL115 Guide.pdf"]));
    const kb = fakeKbClient({ retrievalResults: [] });
    const result = await retrieveKBDocs("obscure clause", kb, "KBID", 0, { withinDocument: "POL115" });
    expect(result.content).toBe(
      'No results found within document "POL115 Guide.pdf" for this query. Retry without within_document to search the whole knowledge base.'
    );
    expect(result.sources).toEqual([]);
    expect(result.documentBlocks).toEqual([]);
  });

  it("keeps the generic no-knowledge fallback for unscoped zero-result searches", async () => {
    process.env.KNOWLEDGE_BUCKET = "test-bucket";
    const kb = fakeKbClient({ retrievalResults: [] });
    const result = await retrieveKBDocs("query", kb, "KBID");
    expect(result.content).toContain("No knowledge available");
    expect(result.content).not.toContain("within_document");
  });
});

/** A non-text chunk as returned by multimodal parsing (no content.text). */
function imageResult(uri, score) {
  return {
    score,
    content: { type: "IMAGE", byteContent: "data:image/png;base64,AAAA" },
    location: { s3Location: { uri } },
    metadata: { "x-amz-bedrock-kb-document-page-number": 2 },
  };
}

/** Fake BedrockAgentRuntimeClient: send() resolves with the given pages in order. */
function pagedClient(...responses) {
  const send = vi.fn();
  for (const r of responses) send.mockResolvedValueOnce(r);
  return { send };
}

describe("non-text chunks", () => {
  it("hasTextContent rejects image chunks and blank text", () => {
    expect(hasTextContent(kbResult("s3://b/a.pdf", 1, "text"))).toBe(true);
    expect(hasTextContent(imageResult("s3://b/a.pdf", 1))).toBe(false);
    expect(hasTextContent(kbResult("s3://b/a.pdf", 1, "   "))).toBe(false);
    expect(hasTextContent(null)).toBe(false);
  });

  it("query_db drops an IMAGE chunk instead of failing the whole search", async () => {
    const kb = pagedClient({
      retrievalResults: [imageResult("s3://b/slides.pdf", 1.6), kbResult("s3://b/doc.pdf", 1.4, "real text")],
    });
    const result = await retrieveKBDocs("query", kb, "KBID");
    expect(result.sources).toHaveLength(1);
    expect(result.documentBlocks).toHaveLength(1);
    expect(result.documentBlocks[0].source.data).toBe("real text");
  });

  it("retrieve_full_document skips IMAGE chunks", async () => {
    mockS3Send.mockRejectedValueOnce(new Error("no metadata"));
    const kb = pagedClient({
      retrievalResults: [imageResult("s3://b/doc.pdf", 1.6), kbResult("s3://b/doc.pdf", 1.4, "page text")],
    });
    const result = await retrieveFullDocument("doc.pdf", kb, "KBID", null, 0);
    expect(result.documentBlocks).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });
});

describe("retrieveFullDocument size budget", () => {
  function chunk(page, len = 100) {
    return {
      score: 1,
      content: { text: "x".repeat(len) },
      location: { s3Location: { uri: "s3://b/big.pdf" } },
      metadata: { "x-amz-bedrock-kb-document-page-number": page },
    };
  }

  beforeEach(() => {
    mockS3Send.mockRejectedValue(new Error("no metadata"));
  });

  it("returns a small document whole, in page order, with no truncation note", async () => {
    const kb = pagedClient({ retrievalResults: [chunk(3), chunk(1), chunk(2)] });
    const result = await retrieveFullDocument("big.pdf", kb, "KBID", null, 0);
    expect(result.truncated).toBe(false);
    expect(result.note).toBe("");
    expect(result.sources.map(s => s.page)).toEqual([1, 2, 3]);
    expect(result.sources.map(s => s.chunkIndex)).toEqual([1, 2, 3]);
  });

  it("caps total characters and tells the model the document was cut", async () => {
    // 10 chunks of 30K chars = 300K chars; the 120K budget allows 4.
    const results = Array.from({ length: 10 }, (_, i) => chunk(i + 1, 30_000));
    const kb = pagedClient({ retrievalResults: results });
    const result = await retrieveFullDocument("big.pdf", kb, "KBID", "fees", 0);
    const totalChars = result.documentBlocks.reduce((n, b) => n + b.source.data.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_FULL_DOC_CHARS);
    expect(result.documentBlocks).toHaveLength(4);
    expect(result.sources).toHaveLength(4);
    expect(result.truncated).toBe(true);
    expect(result.note).toContain("within_document");
  });

  it("caps the chunk count", async () => {
    const results = Array.from({ length: MAX_FULL_DOC_CHUNKS + 20 }, (_, i) => chunk(i + 1, 10));
    const kb = pagedClient({ retrievalResults: results });
    const result = await retrieveFullDocument("big.pdf", kb, "KBID", null, 0);
    expect(result.documentBlocks).toHaveLength(MAX_FULL_DOC_CHUNKS);
    expect(result.truncated).toBe(true);
  });

  it("stops paginating after MAX_FULL_DOC_PAGES and flags truncation", async () => {
    const pages = Array.from({ length: MAX_FULL_DOC_PAGES + 3 }, (_, i) => ({
      retrievalResults: [chunk(i + 1, 10)],
      nextToken: `t${i}`,
    }));
    const kb = pagedClient(...pages);
    const result = await retrieveFullDocument("big.pdf", kb, "KBID", null, 0);
    expect(kb.send).toHaveBeenCalledTimes(MAX_FULL_DOC_PAGES);
    expect(result.documentBlocks).toHaveLength(MAX_FULL_DOC_PAGES);
    expect(result.truncated).toBe(true);
  });
});
