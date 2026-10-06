/**
 * @module persistence
 *
 * DynamoDB and session-handler access for the chat handler: loading the
 * authoritative session, saving turns, response traces, disconnect markers,
 * and shaping what is stored so items stay small and free of short-lived
 * credentials.
 */

import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { logger } from "./logger.mjs";

const ddbClient = new DynamoDBClient({});
const lambdaClient = new LambdaClient({});

/** Source fields worth keeping once the live response has been delivered. */
const STORED_SOURCE_FIELDS = ["chunkIndex", "title", "s3Key", "page", "excerpt", "score", "sourceType", "cited"];

/** Most sources stored per turn (the UI only lists cited ones anyway). */
export const MAX_STORED_SOURCES = 50;

/**
 * Ceiling for one turn's serialized metadata. A session row holds every turn
 * in a single DynamoDB item (400 KB hard limit), so per-turn metadata must
 * stay a small fraction of that.
 */
export const MAX_STORED_METADATA_CHARS = 30_000;

/**
 * Copy sources without their presigned `uri`.
 *
 * A presigned URL expires after an hour and embeds the Lambda role's
 * temporary session token, so it is useless on reload and must not sit in a
 * table. The frontend re-presigns from `s3Key` via the source-presign API.
 *
 * @param {Array<object>} sources
 * @returns {Array<object>} New source objects with only the stored fields.
 */
export function sanitizeSourcesForStorage(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src) => {
    const out = {};
    for (const field of STORED_SOURCE_FIELDS) {
      if (src?.[field] !== undefined) out[field] = src[field];
    }
    return out;
  });
}

/**
 * Serialize a turn's metadata ({ Sources, Trace, ContextUsage }) for the
 * session row: presigned URIs stripped, at most MAX_STORED_SOURCES sources,
 * and if the JSON is still over MAX_STORED_METADATA_CHARS the excerpts are
 * dropped, then sources are halved until it fits.
 *
 * @param {{Sources?: Array<object>, Trace?: object, ContextUsage?: object}} metadata
 * @returns {string} JSON string for the `metadata` attribute.
 */
export function buildStoredMetadata(metadata) {
  let sources = sanitizeSourcesForStorage(metadata?.Sources).slice(0, MAX_STORED_SOURCES);
  const serialize = () => JSON.stringify({ ...metadata, Sources: sources });

  let json = serialize();
  if (json.length <= MAX_STORED_METADATA_CHARS) return json;

  sources = sources.map(({ excerpt, ...rest }) => rest);
  json = serialize();
  while (json.length > MAX_STORED_METADATA_CHARS && sources.length > 0) {
    sources = sources.slice(0, Math.floor(sources.length / 2));
    json = serialize();
  }
  return json;
}


// ---------------------------------------------------------------------------
// DynamoDB / session-handler access
// ---------------------------------------------------------------------------

/**
 * Persist a response trace row to the ResponseTrace DynamoDB table.
 *
 * Each chat turn produces one trace record capturing the user prompt, final
 * answer, retrieved sources, and model/prompt metadata. This powers the admin
 * evaluation pipeline and audit trail. Silently no-ops if the table env var
 * is not configured (e.g., in local testing).
 *
 * @param {Object} params
 * @param {string} params.messageId - Unique ID for this message (UUID).
 * @param {string} params.sessionId - Chat session ID.
 * @param {number} params.turnIndex - 1-based turn number within the session.
 * @param {string} params.userPrompt - The user's original message text.
 * @param {string} params.finalAnswer - The model's final streamed answer.
 * @param {Array} params.sources - Array of source objects (KB docs + Excel).
 * @param {string} params.promptVersionId - Prompt version from the prompt registry.
 * @param {string} params.promptTemplateHash - Hash of the prompt template used.
 * @param {string} params.modelId - Bedrock model ID used for this turn.
 * @param {string} params.guardrailId - Bedrock Guardrail ID (empty if disabled).
 */
export async function writeResponseTrace({
  messageId,
  sessionId,
  turnIndex,
  userPrompt,
  finalAnswer,
  sources,
  promptVersionId,
  promptTemplateHash,
  modelId,
  guardrailId,
  userId,
}) {
  const tableName = process.env.RESPONSE_TRACE_TABLE;
  if (!tableName) {
    return;
  }

  const createdAt = new Date().toISOString();
  const item = {
    MessageId: { S: messageId },
    SessionId: { S: sessionId },
    CreatedAt: { S: createdAt },
    TurnIndex: { N: String(turnIndex) },
    UserPrompt: { S: userPrompt },
    FinalAnswer: { S: finalAnswer || "" },
    Sources: { S: JSON.stringify(sources || []) },
    RetrievalSnapshot: { S: JSON.stringify({ sources: sources || [] }) },
    PromptVersionId: { S: promptVersionId || "embedded-default" },
    PromptTemplateHash: { S: promptTemplateHash || "" },
    ModelId: { S: modelId || process.env.PRIMARY_MODEL_ID || "" },
    GuardrailId: { S: guardrailId || "" },
    TraceSummary: { S: JSON.stringify({
      sourceCount: Array.isArray(sources) ? sources.length : 0,
    }) },
  };
  // UserId lets the feedback handler verify ownership when a user submits
  // feedback against this message — without it any authenticated user can
  // POST /feedback with someone else's messageId and read the question/answer.
  if (userId) {
    item.UserId = { S: String(userId) };
  }
  await ddbClient.send(new PutItemCommand({
    TableName: tableName,
    Item: item,
  }));
}

/**
 * Classify a session-handler invocation result.
 *
 * @param {object} response - LambdaClient InvokeCommand output.
 * @returns {{failure: object|null, body: object|null}} `failure` is null on
 *   success, otherwise details (Lambda FunctionError, a 4xx/5xx statusCode,
 *   or an unparseable reply). `body` is the parsed JSON body when there is one.
 */
export function parseHandlerReply(response) {
  if (response?.FunctionError) {
    return { failure: { reason: "function_error", functionError: response.FunctionError }, body: null };
  }
  if (!response?.Payload) return { failure: null, body: null };
  try {
    const parsed = JSON.parse(Buffer.from(response.Payload).toString());
    if (parsed.statusCode && parsed.statusCode >= 400) {
      return {
        failure: { reason: "error_response", statusCode: parsed.statusCode, body: String(parsed.body ?? "").slice(0, 500) },
        body: null,
      };
    }
    let body = parsed.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    return { failure: null, body: body && typeof body === "object" ? body : null };
  } catch (err) {
    return { failure: { reason: "unparseable_response", error: err?.message }, body: null };
  }
}

/**
 * Invoke the session handler to append a chat entry.
 *
 * When the handler reports `trimmed: true` (it dropped older turns to keep
 * the session row under DynamoDB's item limit) the save succeeded, but a
 * warning is logged so the loss of old history is visible.
 *
 * @param {InvokeCommand} command - The prepared append_chat_entry invocation.
 * @returns {Promise<object|null>} null on success, otherwise details of the
 *   failure (invoke error, Lambda FunctionError, or a 4xx/5xx response).
 */
export async function saveSessionEntry(command) {
  let response;
  try {
    response = await lambdaClient.send(command);
  } catch (err) {
    return { reason: "invoke_failed", error: err?.message, name: err?.name };
  }
  const { failure, body } = parseHandlerReply(response);
  if (!failure && body?.trimmed === true) {
    logger.warn("Session history was trimmed to stay under the DynamoDB item limit", {
      removedEntries: body.removed_entries ?? body.removedEntries,
    });
  }
  return failure;
}

/**
 * Key prefix for clean-disconnect markers stored in the response-trace table
 * (reusing it avoids a new table; the prefix keeps markers out of trace
 * queries, which look up real message UUIDs).
 */
const DISCONNECT_MARKER_PREFIX = "WSDISCONNECT#";

/**
 * Marker lifetime. It only needs to outlive the longest possible chat
 * invocation (Lambda caps at 15 minutes); the table's TTL deletes it after.
 */
const DISCONNECT_MARKER_TTL_SECONDS = 30 * 60;

/**
 * Record that API Gateway delivered a clean $disconnect for this connection.
 *
 * A deliberate client stop (stop button, tab close, refresh) closes the
 * socket properly, so $disconnect fires within moments. A network-path
 * failure (VPN/proxy/NAT silently severing the connection) instead leaves a
 * half-open socket: sends start returning 410 GoneException but no
 * $disconnect arrives until much later, if ever. The streaming loop reads
 * this marker to tell the two apart and decide whether to discard or finish
 * and save the in-flight answer.
 */
export async function writeDisconnectMarker(connectionId) {
  const tableName = process.env.RESPONSE_TRACE_TABLE;
  if (!tableName || !connectionId) return;
  try {
    await ddbClient.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        MessageId: { S: DISCONNECT_MARKER_PREFIX + connectionId },
        DisconnectedAt: { S: new Date().toISOString() },
        expiresAt: { N: String(Math.floor(Date.now() / 1000) + DISCONNECT_MARKER_TTL_SECONDS) },
      },
    }));
  } catch (err) {
    logger.warn("Failed to write disconnect marker", { error: err?.message });
  }
}

/** True when a clean $disconnect marker exists for this connection. */
export async function hasDisconnectMarker(connectionId) {
  const tableName = process.env.RESPONSE_TRACE_TABLE;
  if (!tableName || !connectionId) return false;
  try {
    const resp = await ddbClient.send(new GetItemCommand({
      TableName: tableName,
      Key: { MessageId: { S: DISCONNECT_MARKER_PREFIX + connectionId } },
      ConsistentRead: true,
    }));
    return !!resp.Item;
  } catch (err) {
    // Can't tell; classify as a network drop so the answer is saved rather
    // than destroyed. Worst case a deliberately stopped answer reappears on
    // reload -- benign next to losing one the user wanted.
    logger.warn("Failed to read disconnect marker", { error: err?.message });
    return false;
  }
}

/**
 * Defensive per-field cap (characters) for prior turns loaded from DynamoDB.
 *
 * Stored turns are server-authored -- user text is already bounded by
 * MAX_MESSAGE_LENGTH and assistant text by the model's output-token cap
 * (~16K tokens) -- so this is purely defense-in-depth against a corrupted or
 * poisoned table row. It is set well above any legitimate single answer so it
 * never truncates real content; the agentic loop's context compression is the
 * mechanism that handles genuinely large histories.
 */
const MAX_HISTORY_FIELD_CHARS = 100_000;

/**
 * Coerce stored chat history into the {user, chatbot} shape the model adapter
 * expects, dropping anything malformed.
 *
 * The only trusted source of prior turns is the DynamoDB session row; this
 * function still validates that row's shape so a single bad entry can't crash
 * history assembly. Each field is coerced to a string and capped at
 * MAX_HISTORY_FIELD_CHARS. Non-object entries are skipped.
 *
 * @param {unknown} rawHistory - The `chat_history` attribute from DynamoDB.
 * @returns {Array<{user: string, chatbot: string}>} Sanitized turns (oldest first).
 */
export function sanitizeStoredHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const clean = [];
  for (const entry of rawHistory) {
    if (!entry || typeof entry !== "object") continue;
    const user = typeof entry.user === "string" ? entry.user.slice(0, MAX_HISTORY_FIELD_CHARS) : "";
    const chatbot = typeof entry.chatbot === "string" ? entry.chatbot.slice(0, MAX_HISTORY_FIELD_CHARS) : "";
    clean.push({ user, chatbot });
  }
  return clean;
}

/**
 * Load the authoritative conversation state for a session from DynamoDB.
 *
 * SECURITY: This is the trust boundary for conversation history. The
 * client-supplied `chatHistory` in the WebSocket frame is fully
 * attacker-controlled -- any holder of a valid Cognito JWT could forge prior
 * "assistant" turns to bypass the system prompt or inject false context. We
 * therefore ignore it entirely and reconstruct prior turns only from the
 * session row stored under the JWT-verified `userId` + `sessionId`.
 *
 * Returns empty history + null summary on a brand-new session or any fetch
 * failure (fail-closed: a transient read error is treated as "no prior
 * context" rather than silently trusting the client).
 *
 * @param {string} userId - JWT-verified principal (NOT a client body field).
 * @param {string} sessionId - Session identifier from the request.
 * @returns {Promise<{history: Array<{user: string, chatbot: string}>, contextSummary: string|null}>}
 */
export async function loadAuthoritativeSession(userId, sessionId) {
  try {
    const sessionFetch = await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.SESSION_HANDLER,
      Payload: JSON.stringify({
        body: JSON.stringify({
          operation: "get_session",
          user_id: userId,
          session_id: sessionId,
        })
      }),
    }));
    const sessionData = JSON.parse(Buffer.from(sessionFetch.Payload).toString());
    if (sessionData.statusCode === 200) {
      const sessionBody = JSON.parse(sessionData.body);
      return {
        history: sanitizeStoredHistory(sessionBody.chat_history),
        contextSummary: sessionBody.context_summary || null,
      };
    }
  } catch (fetchErr) {
    logger.error("Failed to fetch authoritative session", { error: fetchErr?.message });
  }
  return { history: [], contextSummary: null };
}

/**
 * Save the running compaction summary on the session row so a reload (or
 * the next turn) resumes from it. Throws on failure, including an error
 * statusCode in the handler's reply; callers decide how loudly to log.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} contextSummary
 */
export async function persistContextSummary(userId, sessionId, contextSummary) {
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: process.env.SESSION_HANDLER,
    Payload: JSON.stringify({
      body: JSON.stringify({
        operation: "update_context_summary",
        user_id: userId,
        session_id: sessionId,
        context_summary: contextSummary,
      })
    }),
  }));
  const { failure } = parseHandlerReply(response);
  if (failure) {
    throw new Error(`Context summary save failed: ${JSON.stringify(failure)}`);
  }
}
