import { describe, it, expect } from "vitest";
import {
  sanitizeSourcesForStorage,
  buildStoredMetadata,
  MAX_STORED_SOURCES,
  MAX_STORED_METADATA_CHARS,
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
