import { describe, it, expect, vi, beforeEach } from "vitest";

const getSignedUrl = vi.hoisted(() => vi.fn(async () => "https://signed.example"));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: vi.fn() }; }),
  GetObjectCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

const { handler, isSafeKey, contentDisposition } = await import("./index.mjs");

const call = (s3Key) => handler({ body: JSON.stringify({ s3Key }) });

beforeEach(() => getSignedUrl.mockClear());

describe("isSafeKey", () => {
  it.each([
    "Smith's Notes.pdf",
    "Q#4 report.pdf",
    "Résumé – final.docx",
    "政策/手册.pdf",
    "folder/Report..v2.pdf",
    "Document (8).pdf",
  ])("allows %s", (key) => {
    expect(isSafeKey(key)).toBe(true);
  });

  it.each([
    "../secret.pdf",
    "a/../../b.pdf",
    "/abs.pdf",
    "a//b.pdf",
    "./a.pdf",
    "a\\b.pdf",
    "bad\u0000name.pdf",
    "line\nbreak.pdf",
    "",
    "x".repeat(1025),
    42,
  ])("rejects %j", (key) => {
    expect(isSafeKey(key)).toBe(false);
  });
});

describe("handler", () => {
  it("presigns a unicode filename inline", async () => {
    const res = await call("Résumé's #1.pdf");
    expect(res.statusCode).toBe(200);
    const cmd = getSignedUrl.mock.calls[0][1];
    expect(cmd.Key).toBe("Résumé's #1.pdf");
    expect(cmd.ResponseContentDisposition).toBe("inline");
  });

  it("serves HTML as a download, never inline", async () => {
    const res = await call("guides/intro page.html");
    expect(res.statusCode).toBe(200);
    const cmd = getSignedUrl.mock.calls[0][1];
    expect(cmd.ResponseContentDisposition).toBe("attachment; filename*=UTF-8''intro%20page.html");
  });

  it("still blocks metadata.txt in any folder and case", async () => {
    expect((await call("metadata.txt")).statusCode).toBe(400);
    expect((await call("sub/METADATA.TXT")).statusCode).toBe(400);
  });

  it("rejects traversal and unknown extensions", async () => {
    expect((await call("../x.pdf")).statusCode).toBe(400);
    expect((await call("tool.exe")).statusCode).toBe(400);
    expect((await call("noextension")).statusCode).toBe(400);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("contentDisposition is inline for viewable types", () => {
    expect(contentDisposition("pdf", "a.pdf")).toBe("inline");
  });
});
