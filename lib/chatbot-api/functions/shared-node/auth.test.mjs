import { describe, it, expect, vi, afterEach } from "vitest";

// Packages not installed at the repo root (the Lambda runtime provides
// them); the handlers construct clients at import time.
vi.mock("@aws-sdk/client-dynamodb", () => {
  const Cmd = vi.fn(function (i) { return i; });
  return {
    DynamoDBClient: vi.fn(function () { return { send: vi.fn() }; }),
    QueryCommand: Cmd, DeleteItemCommand: Cmd, PutItemCommand: Cmd, UpdateItemCommand: Cmd,
    BatchWriteItemCommand: Cmd, ScanCommand: Cmd,
  };
});
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(function () { return { send: vi.fn() }; }),
  InvokeCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: vi.fn(function () { return { send: vi.fn() }; }),
  StartExecutionCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-bedrock-agent", () => ({
  BedrockAgentClient: vi.fn(function () { return { send: vi.fn() }; }),
  ListKnowledgeBaseDocumentsCommand: vi.fn(function (i) { return i; }),
}));

import { parseGroupsClaim, getGroups, isAdmin, forbidden } from "./auth.mjs";
import { handler as uploadS3 } from "../knowledge-management/upload-s3/index.mjs";
import { handler as getS3 } from "../knowledge-management/get-s3/index.mjs";
import { handler as evalUpload } from "../llm-eval/S3-upload/index.mjs";
import { handler as evalGetTestCases } from "../llm-eval/S3-get-test-cases/index.mjs";
import { handler as excelIndexApi } from "../excel-index/api/index.mjs";
import { handler as startEval } from "../step-functions/llm-evaluation/start-llm-eval/index.mjs";

const eventWithGroups = (groups) => ({
  requestContext: {
    http: { method: "POST" },
    authorizer: { jwt: { claims: groups === undefined ? {} : { "cognito:groups": groups } } },
  },
  rawPath: "/admin/indexes",
  body: JSON.stringify({ fileName: "a.pdf", fileType: "application/pdf" }),
});

describe("parseGroupsClaim", () => {
  it.each([
    [["Admin", "Staff"], ["Admin", "Staff"]],
    ['["Admin","Staff"]', ["Admin", "Staff"]],
    ["[Admin Staff]", ["Admin", "Staff"]],
    ["[Admin, Staff]", ["Admin", "Staff"]],
    ["Admin", ["Admin"]],
    ["[]", []],
    ["", []],
    [undefined, []],
    [42, []],
  ])("parses %j", (claim, expected) => {
    expect(parseGroupsClaim(claim)).toEqual(expected);
  });
});

describe("isAdmin", () => {
  afterEach(() => {
    delete process.env.ADMIN_GROUP_NAME;
  });

  it("accepts every claim form that contains Admin", () => {
    for (const claim of [["Admin"], '["Staff","Admin"]', "[Staff Admin]", "[Staff, Admin]", "Admin"]) {
      expect(isAdmin(eventWithGroups(claim))).toBe(true);
    }
  });

  it("matches the group name exactly, never as a substring", () => {
    for (const claim of [["Admins"], "NotAdmin", "[admin]", '["SuperAdmin"]', "[Administrators]"]) {
      expect(isAdmin(eventWithGroups(claim))).toBe(false);
    }
  });

  it("is false without claims or authorizer", () => {
    expect(isAdmin(eventWithGroups(undefined))).toBe(false);
    expect(isAdmin({})).toBe(false);
    expect(getGroups(undefined)).toEqual([]);
  });

  it("ignores the removed custom:role attribute", () => {
    const event = { requestContext: { authorizer: { jwt: { claims: { "custom:role": '["Admin"]' } } } } };
    expect(isAdmin(event)).toBe(false);
  });

  it("honors ADMIN_GROUP_NAME", () => {
    process.env.ADMIN_GROUP_NAME = "Operators";
    expect(isAdmin(eventWithGroups(["Operators"]))).toBe(true);
    expect(isAdmin(eventWithGroups(["Admin"]))).toBe(false);
  });

  it("forbidden() is a 403 with a friendly error", () => {
    const res = forbidden({ "X-Test": "1" });
    expect(res.statusCode).toBe(403);
    expect(res.headers["X-Test"]).toBe("1");
    expect(JSON.parse(res.body).error).toMatch(/administrator/);
  });
});

describe("Node admin handlers reject non-admins with 403 (never 500)", () => {
  const handlers = { uploadS3, getS3, evalUpload, evalGetTestCases, excelIndexApi, startEval };

  it.each(Object.entries(handlers))("%s", async (_name, handler) => {
    for (const groups of [undefined, ["Staff"], "NotAdmin"]) {
      const res = await handler(eventWithGroups(groups));
      expect(res.statusCode).toBe(403);
    }
  });
});
