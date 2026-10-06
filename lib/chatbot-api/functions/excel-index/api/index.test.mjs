import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-dynamodb", () => {
  const cmd = (name) => vi.fn(function (input) { return { ...input, __cmd: name }; });
  return {
    DynamoDBClient: vi.fn(function () { return { send: mockDdbSend }; }),
    QueryCommand: cmd("Query"),
    DeleteItemCommand: cmd("DeleteItem"),
    PutItemCommand: cmd("PutItem"),
    UpdateItemCommand: cmd("UpdateItem"),
    BatchWriteItemCommand: cmd("BatchWriteItem"),
  };
});
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(function () { return { send: vi.fn() }; }),
  InvokeCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: mockS3Send }; }),
  PutObjectCommand: vi.fn(function (i) { return i; }),
  DeleteObjectCommand: vi.fn(function (i) { return i; }),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn(async () => "https://signed") }));

process.env.INDEX_REGISTRY_TABLE = "registry";
process.env.TABLE_NAME = "data";
process.env.BUCKET = "bucket";

const { handler } = await import("./index.mjs");

const adminEvent = (method, path, { body, indexId } = {}) => ({
  rawPath: path,
  requestContext: {
    http: { method },
    authorizer: { jwt: { claims: { "cognito:groups": ["Admin"] } } },
  },
  pathParameters: indexId ? { indexId } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

beforeEach(() => {
  mockDdbSend.mockReset();
  mockS3Send.mockReset().mockResolvedValue({});
});

describe("createIndex", () => {
  it("creates a new index with a conditional put", async () => {
    mockDdbSend.mockResolvedValue({});
    const res = await handler(adminEvent("POST", "/admin/indexes", { body: { index_name: "Staff List", display_name: "Staff" } }));
    expect(res.statusCode).toBe(201);
    const put = mockDdbSend.mock.calls[0][0];
    expect(put.__cmd).toBe("PutItem");
    expect(put.Item.sk.S).toBe("staff_list");
    expect(put.ConditionExpression).toContain("attribute_not_exists");
  });

  it("returns 409 instead of overwriting an existing index", async () => {
    mockDdbSend.mockRejectedValue(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }));
    const res = await handler(adminEvent("POST", "/admin/indexes", { body: { index_name: "staff_list", display_name: "Staff" } }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("already exists");
  });

  it("does not leak internal error details on unexpected failures", async () => {
    mockDdbSend.mockRejectedValue(new Error("arn:aws:dynamodb:secret-details"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(adminEvent("POST", "/admin/indexes", { body: { index_name: "x", display_name: "X" } }));
    errSpy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("arn:aws");
  });
});

describe("updateIndex", () => {
  it("updates an existing index only (conditional update)", async () => {
    mockDdbSend.mockResolvedValue({ Attributes: { index_name: { S: "staff" }, display_name: { S: "Staff" } } });
    const res = await handler(adminEvent("PUT", "/admin/indexes/staff", { indexId: "staff", body: { display_name: "Staff" } }));
    expect(res.statusCode).toBe(200);
    expect(mockDdbSend.mock.calls[0][0].ConditionExpression).toContain("attribute_exists");
  });

  it("returns 404 for an unknown index id", async () => {
    mockDdbSend.mockRejectedValue(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }));
    const res = await handler(adminEvent("PUT", "/admin/indexes/nope", { indexId: "nope", body: { description: "x" } }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toContain("nope");
  });
});

describe("deleteIndex", () => {
  const rows = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ pk: { S: "staff" }, sk: { S: `r${offset + i}` } }));

  it("queries the index partition with pagination instead of scanning the table", async () => {
    const batchSizes = [];
    mockDdbSend.mockImplementation(async (cmd) => {
      if (cmd.__cmd === "Query") {
        return cmd.ExclusiveStartKey
          ? { Items: rows(10, 30) }
          : { Items: rows(30), LastEvaluatedKey: { pk: { S: "staff" }, sk: { S: "r29" } } };
      }
      if (cmd.__cmd === "BatchWriteItem") {
        batchSizes.push(cmd.RequestItems.data.length);
        return {};
      }
      return {};
    });

    const res = await handler(adminEvent("DELETE", "/admin/indexes/staff", { indexId: "staff" }));

    expect(res.statusCode).toBe(200);
    const queries = mockDdbSend.mock.calls.map(([c]) => c).filter((c) => c.__cmd === "Query");
    expect(queries).toHaveLength(2);
    expect(queries[0].KeyConditionExpression).toBe("pk = :pk");
    expect(queries[0].ExpressionAttributeValues[":pk"].S).toBe("staff");
    expect(batchSizes).toEqual([25, 5, 10]);
    expect(mockDdbSend.mock.calls.some(([c]) => c.__cmd === "Scan")).toBe(false);
  });

  it("resubmits UnprocessedItems until they are written", async () => {
    let batchCalls = 0;
    mockDdbSend.mockImplementation(async (cmd) => {
      if (cmd.__cmd === "Query") return { Items: rows(3) };
      if (cmd.__cmd === "BatchWriteItem") {
        batchCalls++;
        if (batchCalls === 1) {
          return { UnprocessedItems: { data: cmd.RequestItems.data.slice(1) } };
        }
        expect(cmd.RequestItems.data).toHaveLength(2);
        return { UnprocessedItems: {} };
      }
      return {};
    });

    const res = await handler(adminEvent("DELETE", "/admin/indexes/staff", { indexId: "staff" }));

    expect(res.statusCode).toBe(200);
    expect(batchCalls).toBe(2);
  });
});
