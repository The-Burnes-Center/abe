/**
 * Generic Excel Index Admin API.
 * Parameterized routes for managing indexes:
 *   GET    /admin/indexes              — list all indexes
 *   POST   /admin/indexes              — create a new index
 *   GET    /admin/indexes/{indexId}/status
 *   GET    /admin/indexes/{indexId}/preview
 *   POST   /admin/indexes/{indexId}/upload-url
 *   PUT    /admin/indexes/{indexId}     — update display_name / description
 *   DELETE /admin/indexes/{indexId}
 */
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, QueryCommand, DeleteItemCommand, PutItemCommand, UpdateItemCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isAdmin, forbidden } from "./auth.mjs";

const lambdaClient = new LambdaClient({});
const s3 = new S3Client({});
const ddb = new DynamoDBClient({});

const QUERY_FUNCTION = process.env.QUERY_FUNCTION;
const BUCKET = process.env.BUCKET;
const REGISTRY_TABLE = process.env.INDEX_REGISTRY_TABLE;
const DATA_TABLE = process.env.TABLE_NAME;

const URL_EXPIRATION_SECONDS = 300;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BATCH_SIZE = 25;
/** Attempts per batch while DynamoDB keeps returning UnprocessedItems. */
const MAX_BATCH_ATTEMPTS = 8;
/** First backoff wait between BatchWrite retries; doubles each attempt. */
const BATCH_RETRY_BASE_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "";
  if (method === "OPTIONS") return jsonResponse(200, "");

  if (!isAdmin(event)) {
    return forbidden(corsHeaders);
  }

  const path = event.rawPath || event.requestContext?.http?.path || "";
  const indexId = event.pathParameters?.indexId || null;

  try {
    // GET /admin/indexes — list all indexes
    if (path === "/admin/indexes" && method === "GET") {
      return await listIndexes();
    }

    // POST /admin/indexes — create new index
    if (path === "/admin/indexes" && method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
      return await createIndex(body);
    }

    if (!indexId) return jsonResponse(404, { error: "Not found" });

    // GET /admin/indexes/{indexId}/status
    if (path.endsWith("/status") && method === "GET") {
      return await proxyToQuery(indexId, "status");
    }

    // GET /admin/indexes/{indexId}/preview
    if (path.endsWith("/preview") && method === "GET") {
      return await proxyToQuery(indexId, "preview");
    }

    // POST /admin/indexes/{indexId}/upload-url
    if (path.endsWith("/upload-url") && method === "POST") {
      return await getUploadUrl(indexId);
    }

    // PUT /admin/indexes/{indexId} — update display_name / description
    if (method === "PUT") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
      return await updateIndex(indexId, body);
    }

    // DELETE /admin/indexes/{indexId}
    if (method === "DELETE") {
      return await deleteIndex(indexId);
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (err) {
    console.error("Excel index API error:", err);
    return jsonResponse(500, { error: "Something went wrong managing indexes. Please try again." });
  }
};

async function listIndexes() {
  const resp = await ddb.send(new QueryCommand({
    TableName: REGISTRY_TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": { S: "TOOLS" } },
  }));
  const indexes = (resp.Items || []).map((item) => ({
    index_name: item.index_name?.S || item.sk?.S || "",
    display_name: item.display_name?.S || "",
    description: item.description?.S || "",
    columns: (item.columns?.L || []).map((c) => c.S || ""),
    row_count: parseInt(item.row_count?.N || "0", 10),
    last_updated: item.last_updated?.S || null,
    status: item.status?.S || "NO_DATA",
  }));
  return jsonResponse(200, { indexes });
}

async function createIndex(body) {
  const indexName = body.index_name || body.name;
  const displayName = body.display_name || body.displayName;
  if (!indexName || !displayName) {
    return jsonResponse(400, { error: "index_name and display_name are required" });
  }
  const description = body.description || "";
  const sanitized = String(indexName).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const item = {
    pk: { S: "TOOLS" },
    sk: { S: sanitized },
    index_name: { S: sanitized },
    display_name: { S: displayName },
    columns: { L: [] },
    row_count: { N: "0" },
    last_updated: { S: new Date().toISOString() },
    status: { S: "NO_DATA" },
  };
  if (description) {
    item.description = { S: description };
  }
  try {
    // Never overwrite an existing index: its columns, row count and status
    // would be reset while its rows stay in the data table.
    await ddb.send(new PutItemCommand({
      TableName: REGISTRY_TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }));
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      return jsonResponse(409, { error: `An index named "${sanitized}" already exists. Choose a different name.` });
    }
    throw err;
  }
  return jsonResponse(201, { index_name: sanitized, display_name: displayName, description, status: "NO_DATA" });
}

async function proxyToQuery(indexId, action) {
  const payload = JSON.stringify({ action, index_name: indexId, preview_rows: 10 });
  const resp = await lambdaClient.send(new InvokeCommand({
    FunctionName: QUERY_FUNCTION,
    Payload: payload,
    InvocationType: "RequestResponse",
  }));
  const body = resp.Payload ? Buffer.from(resp.Payload).toString() : "{}";
  const parsed = JSON.parse(body);
  const statusCode = parsed.statusCode ?? 200;
  const bodyStr = typeof parsed.body === "string" ? parsed.body : JSON.stringify(parsed.body ?? {});
  return { statusCode, headers: corsHeaders, body: bodyStr };
}

async function getUploadUrl(indexId) {
  const key = `indexes/${indexId}/latest.xlsx`;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: XLSX_MIME,
  });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRATION_SECONDS });
  return jsonResponse(200, { signedUrl });
}

async function updateIndex(indexId, body) {
  const updates = [];
  const names = {};
  const values = {};

  if (body.display_name !== undefined) {
    updates.push("#dn = :dn");
    names["#dn"] = "display_name";
    values[":dn"] = { S: body.display_name };
  }
  if (body.description !== undefined) {
    updates.push("#desc = :desc");
    names["#desc"] = "description";
    values[":desc"] = { S: body.description };
  }
  if (updates.length === 0) {
    return jsonResponse(400, { error: "Nothing to update" });
  }

  const resp = await ddb.send(new UpdateItemCommand({
    TableName: REGISTRY_TABLE,
    Key: { pk: { S: "TOOLS" }, sk: { S: indexId } },
    UpdateExpression: "SET " + updates.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));

  const item = resp.Attributes || {};
  return jsonResponse(200, {
    index_name: item.index_name?.S || indexId,
    display_name: item.display_name?.S || "",
    description: item.description?.S || "",
  });
}

async function deleteIndex(indexId) {
  // 1. Delete S3 object
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: `indexes/${indexId}/latest.xlsx`,
    }));
  } catch (e) {
    console.warn(`S3 delete for ${indexId} failed (may not exist):`, e.message);
  }

  // 2. Clear this index's rows from the shared data table (pk = index id)
  if (DATA_TABLE) {
    const deleted = await deleteIndexRows(indexId);
    console.log(`Deleted ${deleted} rows for index ${indexId}`);
  }

  // 3. Delete registry entry
  await ddb.send(new DeleteItemCommand({
    TableName: REGISTRY_TABLE,
    Key: { pk: { S: "TOOLS" }, sk: { S: indexId } },
  }));

  return jsonResponse(200, { deleted: indexId });
}

/**
 * Delete every data-table row whose partition key is the index id.
 *
 * Queries the partition (instead of scanning the whole shared table) page by
 * page, deleting each page in BatchWrite chunks of 25.
 *
 * @param {string} indexId
 * @returns {Promise<number>} Rows deleted.
 */
async function deleteIndexRows(indexId) {
  let deleted = 0;
  let lastKey;
  do {
    const page = await ddb.send(new QueryCommand({
      TableName: DATA_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: indexId } },
      ProjectionExpression: "pk, sk",
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    const items = page.Items || [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const requests = items.slice(i, i + BATCH_SIZE).map((item) => ({
        DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
      }));
      await batchWriteWithRetry(requests);
      deleted += requests.length;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return deleted;
}

/**
 * BatchWriteItem that resubmits UnprocessedItems with exponential backoff.
 * DynamoDB returns unprocessed items (rather than an error) when throttled,
 * so ignoring them silently leaves rows behind.
 *
 * @param {Array<object>} requests - Up to 25 write requests for DATA_TABLE.
 */
async function batchWriteWithRetry(requests) {
  let pending = requests;
  for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 0) await sleep(BATCH_RETRY_BASE_MS * 2 ** (attempt - 1));
    const resp = await ddb.send(new BatchWriteItemCommand({
      RequestItems: { [DATA_TABLE]: pending },
    }));
    pending = resp.UnprocessedItems?.[DATA_TABLE] || [];
  }
  if (pending.length > 0) {
    throw new Error(`Could not delete ${pending.length} index rows after ${MAX_BATCH_ATTEMPTS} attempts; try again.`);
  }
}
