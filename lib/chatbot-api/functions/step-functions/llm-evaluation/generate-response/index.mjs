/**
 * Evaluation answer generator (invoked by the RAGAS eval Lambda).
 *
 * Answers a test question the way production chat would, so evaluation
 * scores measure the real assistant:
 *   - same system prompt: the LIVE version of the chat prompt family, read
 *     read-only (this Lambda never writes to the prompt registry);
 *   - same model (PRIMARY_MODEL_ID), guardrail and brand placeholders;
 *   - same tools and tool code (query_db, retrieve_full_document,
 *     fetch_metadata, query_excel_index) via tool-runner.mjs;
 *   - same tool-round cap (MAX_TOOL_ROUNDS, default 25).
 *
 * `chat/` is a symlink to ../../../websocket-chat. CDK copies symlinks that
 * point outside an asset directory as real files, so the deployed bundle
 * carries its own copy of the chat modules and there is one source.
 *
 * Event: { userMessage, chatHistory?: [{user, chatbot}], get_context_only? }
 * Returns { statusCode, body } where body is
 *   - normal:  { modelResponse, context, sources, promptVersionId, toolRounds }
 *   - context: { context, sources }   (get_context_only: one query_db search)
 *
 * Logs carry sizes and counts only, never question or answer text.
 */
import { BedrockAgentRuntimeClient } from "@aws-sdk/client-bedrock-agent-runtime";
import ClaudeModel from "./chat/models/chat-model.mjs";
import { retrieveKBDocs } from "./chat/kb.mjs";
import { getAllTools, constructSysPrompt } from "./chat/tools.mjs";
import { buildAssistantToolMessage, runToolCalls, toolResultsMessage, maxToolRounds } from "./chat/tool-runner.mjs";
import { MAX_STREAM_RETRIES, isTransientError, retryDelayMs, sleep } from "./chat/retry.mjs";
import { sanitizeSourcesForStorage } from "./chat/persistence.mjs";
import { logger } from "./chat/logger.mjs";

/** Prior turns kept from a supplied chatHistory (same window as chat). */
const MAX_HISTORY_TURNS = 12;

/** Answer recorded when the tool-round cap is hit without a final answer. */
const ROUND_CAP_ANSWER = "No answer: the tool-round limit was reached before the assistant finished.";

/**
 * Consume one streamed model response.
 *
 * @returns {Promise<{text: string, toolCalls: Array<{id, name, inputJson}>, stopReason: string|null}>}
 */
async function readStream(claude, stream) {
  let text = "";
  let stopReason = null;
  const pendingTools = new Map();
  for await (const event of stream) {
    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
    const parsed = claude.parseChunk(chunk);
    if (!parsed) continue;
    if (parsed.stop_reason) {
      stopReason = parsed.stop_reason;
    } else if (parsed.type === "tool_use") {
      pendingTools.set(parsed.index, { id: parsed.id, name: parsed.name, inputJson: "" });
    } else if (parsed.kind === "tool_input" && parsed.json != null) {
      const entry = pendingTools.get(parsed.index);
      if (entry) entry.inputJson += parsed.json;
    } else if (parsed.kind === "text") {
      text += parsed.text;
    }
  }
  return { text, toolCalls: [...pendingTools.values()], stopReason };
}

/** One model turn, retrying transient Bedrock errors with jittered backoff. */
async function modelTurn(claude, systemPrompt, history, tools) {
  for (let attempt = 0; ; attempt++) {
    try {
      const stream = await claude.getStreamedResponse(systemPrompt, history, tools);
      return await readStream(claude, stream);
    } catch (err) {
      if (!isTransientError(err) || attempt >= MAX_STREAM_RETRIES) throw err;
      logger.warn("Transient model error, retrying", { name: err?.name, attempt: attempt + 1 });
      await sleep(retryDelayMs(attempt));
    }
  }
}

/** Keep only well-formed {user, chatbot} string turns. */
function sanitizeHistory(chatHistory) {
  if (!Array.isArray(chatHistory)) return [];
  return chatHistory
    .filter((t) => t && typeof t === "object")
    .map((t) => ({ user: String(t.user ?? ""), chatbot: String(t.chatbot ?? "") }))
    .slice(-MAX_HISTORY_TURNS);
}

/** Text of every document block the model was given (RAGAS "contexts"). */
function documentTexts(toolResults) {
  return toolResults.flatMap((r) => (r.documentBlocks || []).map((b) => String(b.source?.data ?? "")));
}

/**
 * Run the production agentic loop for one question.
 *
 * @param {string} userMessage
 * @param {Array<{user: string, chatbot: string}>} chatHistory
 */
export async function generateAnswer(userMessage, chatHistory = []) {
  if (!process.env.KB_ID) throw new Error("Knowledge Base ID is not found.");

  const claude = new ClaudeModel();
  const knowledgeBase = new BedrockAgentRuntimeClient({});
  const promptConfig = await constructSysPrompt({ readOnly: true });
  const { tools, indexes } = await getAllTools();
  const history = claude.assembleHistory(sanitizeHistory(chatHistory), userMessage);
  const state = { sources: [], documentIndexMap: [] };
  const contexts = [];
  const cap = maxToolRounds();

  for (let round = 0; ; round++) {
    const { text, toolCalls, stopReason } = await modelTurn(claude, promptConfig.promptText, history, tools);
    if (stopReason !== "tool_use") {
      return { answer: text, contexts, sources: state.sources, promptVersionId: promptConfig.promptVersionId, toolRounds: round };
    }
    if (round >= cap) {
      logger.warn("Eval hit the tool-round cap", { cap });
      return { answer: ROUND_CAP_ANSWER, contexts, sources: state.sources, promptVersionId: promptConfig.promptVersionId, toolRounds: round };
    }
    const { message, calls } = buildAssistantToolMessage(toolCalls, text);
    history.push(message);
    const toolResults = await runToolCalls(calls, {
      knowledgeBase,
      kbId: process.env.KB_ID,
      indexes,
      state,
      sendStatus: async () => {},
    });
    contexts.push(...documentTexts(toolResults));
    history.push(toolResultsMessage(toolResults));
  }
}

/** Format query_db chunks for the eval UI's "retrieved context" view. */
function formatContext(documentBlocks) {
  const n = documentBlocks.length;
  return documentBlocks.map((block, i) => {
    const source = block.title.replace(/^Source \d+ - /, "");
    return `--- Chunk ${i + 1} of ${n} | Source: ${source} | ${block.context} ---\n\n${block.source.data}`;
  }).join("\n\n");
}

async function contextOnly(userMessage) {
  if (!process.env.KB_ID) throw new Error("Knowledge Base ID is not found.");
  const knowledgeBase = new BedrockAgentRuntimeClient({});
  const result = await retrieveKBDocs(userMessage, knowledgeBase, process.env.KB_ID);
  logger.info("Eval context retrieved", { chunks: result.documentBlocks.length });
  return {
    context: result.documentBlocks.length > 0 ? formatContext(result.documentBlocks) : result.content,
    sources: sanitizeSourcesForStorage(result.sources),
  };
}

export const handler = async (event) => {
  try {
    const userMessage = event?.userMessage;
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "userMessage is required" }) };
    }

    if (event.get_context_only) {
      return { statusCode: 200, body: JSON.stringify(await contextOnly(userMessage)) };
    }

    const result = await generateAnswer(userMessage, event.chatHistory || []);
    logger.info("Eval response generated", {
      questionChars: userMessage.length,
      answerChars: result.answer.length,
      sources: result.sources.length,
      toolRounds: result.toolRounds,
      promptVersionId: result.promptVersionId,
    });
    return {
      statusCode: 200,
      body: JSON.stringify({
        modelResponse: result.answer,
        context: result.contexts.join("\n\n"),
        sources: sanitizeSourcesForStorage(result.sources),
        promptVersionId: result.promptVersionId,
        toolRounds: result.toolRounds,
      }),
    };
  } catch (error) {
    logger.error("Eval response generation failed", { error: error?.message, name: error?.name });
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate a response." }) };
  }
};
