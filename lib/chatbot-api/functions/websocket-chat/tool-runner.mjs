/**
 * @module tool-runner
 *
 * Executes the model's tool calls for one agentic round and builds the
 * tool_result message that goes back into history. Shared by the chat
 * handler (index.mjs) and the evaluation Lambda (generate-response), so
 * evaluation exercises exactly the tools production chat uses.
 *
 * Citation bookkeeping lives in `state`:
 *   - `state.sources`: every source gathered this turn, numbered by
 *     `chunkIndex` (1-based, monotonically increasing).
 *   - `state.documentIndexMap`: sources in the order their document blocks
 *     enter the request, so a native citation's `document_index` maps back
 *     to its source.
 * Tools run sequentially (not Promise.all) because each one numbers its
 * sources from the current `state.sources.length`.
 */

import { retrieveKBDocs, retrieveFullDocument } from './kb.mjs';
import { truncate, capToolResultSize, fetchMetadata, enrichExcelIndexResult, invokeIndexQuery, EXCEL_DEFAULT_LIMIT } from './tools.mjs';
import { logger } from './logger.mjs';

/**
 * Default cap on agentic tool rounds per request (one round = one model
 * response that asks for tools, however many tools it batches). Enough for
 * multi-document digging; a request that needs more is almost always stuck
 * re-querying.
 */
export const DEFAULT_MAX_TOOL_ROUNDS = 25;

/**
 * Tool-round cap for this invocation: MAX_TOOL_ROUNDS env var when it is a
 * positive integer, else DEFAULT_MAX_TOOL_ROUNDS.
 *
 * @returns {number}
 */
export function maxToolRounds() {
  const fromEnv = parseInt(process.env.MAX_TOOL_ROUNDS ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_TOOL_ROUNDS;
}

/**
 * Parse each pending tool call's accumulated JSON input and build the
 * assistant message (any pre-tool text, then every tool_use block).
 * Unparseable inputs get `parsedInput = null` and an empty input object.
 *
 * @param {Array<{id: string, name: string, inputJson: string}>} toolCalls
 * @param {string} text - Text the model streamed before the tool calls.
 * @returns {{message: object, calls: Array<object>}} The assistant message and
 *   the calls with `parsedInput` set (new objects; the inputs are untouched).
 */
export function buildAssistantToolMessage(toolCalls, text) {
  const content = text ? [{ type: "text", text }] : [];
  const calls = toolCalls.map((tc) => {
    let parsedInput = null;
    try {
      parsedInput = JSON.parse(tc.inputJson);
    } catch (parseError) {
      logger.error("Failed to parse tool input", { tool: tc.name, id: tc.id, error: parseError?.message });
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: parsedInput ?? {} });
    return { ...tc, parsedInput };
  });
  return { message: { role: "assistant", content }, calls };
}

/**
 * Build the single user message carrying every tool result. Per the
 * Anthropic API, tool_result blocks come first, then document blocks.
 *
 * @param {Array<{toolId: string, content: string, documentBlocks?: Array}>} toolResults
 * @returns {{role: "user", content: Array}}
 */
export function toolResultsMessage(toolResults) {
  const resultBlocks = toolResults.map((result) => ({
    type: "tool_result",
    tool_use_id: result.toolId,
    content: result.content,
  }));
  const docBlocks = toolResults.flatMap((result) => result.documentBlocks || []);
  return { role: "user", content: [...resultBlocks, ...docBlocks] };
}

/** Record retrieved sources in the turn's citation state. */
function recordSources(state, sources) {
  state.sources = state.sources.concat(sources);
  state.documentIndexMap.push(...sources);
}

async function runQueryDb(tc, query, ctx) {
  const withinDocument = query.within_document || null;
  logger.info("Tool call: query_db", { within_document: withinDocument });
  const statusQuery = truncate(query.query);
  const statusDoc = truncate(withinDocument);
  await ctx.sendStatus(statusDoc
    ? `Searching "${statusDoc}" for "${statusQuery}"...`
    : statusQuery ? `Searching documents for "${statusQuery}"...` : "Searching documents...");
  const docResult = await retrieveKBDocs(query.query, ctx.knowledgeBase, ctx.kbId, ctx.state.sources.length, { withinDocument });
  recordSources(ctx.state, docResult.sources);
  const text = docResult.documentBlocks.length > 0
    ? `Retrieved ${docResult.documentBlocks.length} relevant documents. Analyze the attached documents to answer the user's question.`
    : docResult.content;
  logger.info("Tool result: query_db", { docCount: docResult.documentBlocks.length });
  return { toolId: tc.id, content: text, documentBlocks: docResult.documentBlocks };
}

async function runRetrieveFullDocument(tc, query, ctx) {
  logger.info("Tool call: retrieve_full_document", { document_name: query.document_name });
  await ctx.sendStatus(`Retrieving full document "${truncate(query.document_name)}"...`);
  const result = await retrieveFullDocument(
    query.document_name, ctx.knowledgeBase, ctx.kbId,
    query.query_context || null, ctx.state.sources.length
  );
  recordSources(ctx.state, result.sources);
  let text = result.content;
  if (result.documentBlocks.length > 0) {
    text = result.truncated
      ? `Retrieved part of document "${query.document_name}" (${result.documentBlocks.length} chunks). ${result.note}`
      : `Retrieved complete document "${query.document_name}" (${result.documentBlocks.length} chunks). Analyze the attached document blocks — they contain the full document in page order.`;
  }
  logger.info("Tool result: retrieve_full_document", { chunkCount: result.documentBlocks.length, truncated: !!result.truncated });
  return { toolId: tc.id, content: text, documentBlocks: result.documentBlocks };
}

async function runFetchMetadata(tc, query, ctx) {
  const full = query?.full === true;
  const filenameContains = (typeof query?.filename_contains === "string" && query.filename_contains.trim()) || null;
  logger.info("Tool call: fetch_metadata", { full, filename_contains: filenameContains });
  await ctx.sendStatus(filenameContains
    ? `Fetching document inventory for "${truncate(filenameContains)}"...`
    : "Fetching document inventory...");
  const metadata = await fetchMetadata({ full, filenameContains });
  logger.info("Tool result: fetch_metadata");
  return { toolId: tc.id, content: metadata ? capToolResultSize(JSON.stringify(metadata)) : "No metadata available.", documentBlocks: [] };
}

/** Map the model's query_excel_index input onto the query Lambda's payload. */
function excelQueryPayload(indexName, query) {
  return {
    action: "query",
    index_name: indexName,
    free_text: query.free_text || null,
    filters: query.filters || null,
    date_before: query.date_before || null,
    date_after: query.date_after || null,
    columns: Array.isArray(query.columns) ? query.columns : null,
    count_only: query.count_only === true,
    count_unique: query.count_unique || null,
    group_by: query.group_by || null,
    group_by_value_max: query.group_by_value_max || null,
    distinct_values: query.distinct_values || null,
    min_value: query.min_value || null,
    max_value: query.max_value || null,
    sort_by: query.sort_by || null,
    sort_order: query.sort_order || "asc",
    limit: typeof query.limit === "number" ? query.limit : EXCEL_DEFAULT_LIMIT,
    offset: typeof query.offset === "number" ? query.offset : 0,
  };
}

/** One-line description of an Excel result for the sources sidebar. */
function excelExcerptFor(query, resultStr) {
  try {
    const resultData = JSON.parse(resultStr);
    let excerpt = `${resultData.total_matches || 0} rows matched`;
    if (query.free_text) excerpt += ` for "${query.free_text}"`;
    if (query.filters && Object.keys(query.filters).length > 0) {
      excerpt += ` with filters: ${Object.entries(query.filters).map(([k, v]) => `${k}="${v}"`).join(", ")}`;
    }
    return excerpt;
  } catch (_) {
    return "Excel index query results";
  }
}

async function runQueryExcelIndex(tc, query, ctx) {
  const indexName = query.index_name;
  const idxMeta = ctx.indexes.find(i => i.index_name === indexName);
  const indexDisplayName = idxMeta?.display_name || indexName;
  const searchTerm = truncate(query.free_text);
  logger.info("Tool call: query_excel_index", { indexName });
  if (searchTerm) {
    await ctx.sendStatus(`Searching ${indexDisplayName} for "${searchTerm}"...`);
  } else if (query.filters && Object.keys(query.filters).length > 0) {
    await ctx.sendStatus(`Searching ${indexDisplayName} with filters...`);
  } else {
    await ctx.sendStatus(`Searching ${indexDisplayName}...`);
  }

  let resultStr = await invokeIndexQuery(excelQueryPayload(indexName, query));
  resultStr = await enrichExcelIndexResult(query, indexName, resultStr, idxMeta);
  resultStr = capToolResultSize(resultStr);

  const excelSourceIndex = ctx.state.sources.length + 1;
  const excerpt = excelExcerptFor(query, resultStr);
  const excelSource = {
    chunkIndex: excelSourceIndex,
    title: indexDisplayName,
    uri: null,
    excerpt,
    score: null,
    page: null,
    s3Key: null,
    sourceType: "excelIndex"
  };
  recordSources(ctx.state, [excelSource]);
  const excelDocBlock = {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: String(resultStr) },
    title: `Source ${excelSourceIndex} - ${indexDisplayName} (Excel Data)`,
    context: excerpt,
    citations: { enabled: true }
  };
  logger.info("Tool result: query_excel_index");
  return { toolId: tc.id, content: `Excel query results from ${indexDisplayName}. Analyze the attached document.`, documentBlocks: [excelDocBlock] };
}

const TOOL_HANDLERS = {
  query_db: runQueryDb,
  retrieve_full_document: runRetrieveFullDocument,
  fetch_metadata: runFetchMetadata,
  query_excel_index: runQueryExcelIndex,
};

/**
 * Execute one round of tool calls, in order.
 *
 * @param {Array<{id: string, name: string, parsedInput: object|null}>} calls
 * @param {object} ctx
 * @param {object} ctx.knowledgeBase - BedrockAgentRuntimeClient.
 * @param {string} ctx.kbId - Knowledge Base id.
 * @param {Array<object>} ctx.indexes - Excel index metadata from getAllTools().
 * @param {{sources: Array, documentIndexMap: Array}} ctx.state - Citation
 *   state, updated in place as tools add sources.
 * @param {(text: string) => Promise<void>} ctx.sendStatus - Shows a transient
 *   status line to the user (a no-op for evaluation). Must not throw.
 * @returns {Promise<Array<{toolId: string, content: string, documentBlocks: Array}>>}
 */
export async function runToolCalls(calls, ctx) {
  const toolResults = [];
  for (const tc of calls) {
    if (tc.parsedInput === null) {
      toolResults.push({ toolId: tc.id, content: `Error: the input for tool "${tc.name}" could not be parsed as valid JSON. Please retry with a correctly structured JSON object matching the tool's schema.`, documentBlocks: [] });
      continue;
    }
    // Own-property check: a model-supplied name like "constructor" or
    // "__proto__" must not resolve to an inherited Object property.
    const run = Object.hasOwn(TOOL_HANDLERS, tc.name) ? TOOL_HANDLERS[tc.name] : null;
    if (!run) {
      logger.warn("Unknown tool requested", { tool: tc.name });
      toolResults.push({ toolId: tc.id, content: "Unknown tool requested.", documentBlocks: [] });
      continue;
    }
    toolResults.push(await run(tc, tc.parsedInput, ctx));
  }
  return toolResults;
}
