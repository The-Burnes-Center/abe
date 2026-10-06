/**
 * @module websocket-chat/index
 *
 * WebSocket chat handler for the ABE chatbot.
 *
 * This is the main entry point for all chat interactions. It receives messages
 * over API Gateway WebSocket, runs an agentic tool-use loop against Bedrock
 * (Claude), and streams the response back to the client chunk-by-chunk.
 *
 * ## Agentic Loop Overview
 *
 * The handler implements a state machine that iterates until the model produces
 * a final text response (stop_reason !== "tool_use") or a safety limit is hit:
 *
 *   1. Send conversation history + tools to Bedrock and open a streaming response.
 *   2. Accumulate streamed text deltas and tool_use input deltas.
 *   3. On stop_reason "tool_use": execute all pending tool calls, append results
 *      to history, and loop back to step 1.
 *   4. On stop_reason "end_turn" / "max_tokens": finalize citations, stream
 *      the answer to the client, and exit the loop.
 *
 * ## Safety Rails
 *
 * - MAX_TOOL_ROUNDS caps tool rounds per request (default 25); hitting it
 *   ends the turn with a clear "try a narrower question" answer.
 * - COMPRESSION_THRESHOLD triggers automatic history summarization.
 * - MAX_ESTIMATED_TOKENS triggers aggressive trimming of large tool results.
 * - MAX_STREAM_RETRIES retries transient Bedrock errors (throttles, timeouts)
 *   per round, with jittered exponential backoff.
 * - The connection's `gone` latch short-circuits sends after a disconnect.
 *
 * ## Message Protocol (WebSocket Data field)
 *
 * - Plain text: streamed answer chunks (client appends to UI)
 * - "!<|STATUS|>!...": transient status indicator (e.g., "Searching documents...")
 * - "!<|REPLACE|>!...": replace the text shown so far (citation-finalized answer)
 * - "<!ERROR!>: ...": terminal error shown to user
 * - "!<|EOF_STREAM|>!": signals end of answer; next frame is JSON metadata
 *   shaped as `{ Sources, Trace, ContextUsage }`. ContextUsage carries
 *   `{ estimatedTokens, maxTokens, percent, compactionRounds }` so the client
 *   can render a live memory-usage indicator.
 *
 * ## Context management
 *
 * When estimated tokens exceed COMPRESSION_THRESHOLD the loop runs up to
 * MAX_COMPACTION_ROUNDS recursive summarization passes (tier 1 -> 2 -> 3),
 * pinning the question being answered right now at the top so it survives
 * every compaction. If even after all rounds the request still
 * exceeds MAX_ESTIMATED_TOKENS, the assistant emits a friendly inline note
 * asking the user to start a fresh chat -- never an out-of-band error frame.
 *
 * ## Module layout
 *
 * connection.mjs (WebSocket sends, stop detection), stream-turn.mjs (one
 * streamed response), tool-runner.mjs (tool execution), compaction.mjs
 * (context window), persistence.mjs (DynamoDB / session handler),
 * citations.mjs, kb.mjs, tools.mjs, retry.mjs.
 */

import { BedrockAgentRuntimeClient } from "@aws-sdk/client-bedrock-agent-runtime";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import ClaudeModel from "./models/chat-model.mjs";
import { randomUUID } from "crypto";

import { insertCitationMarkers, validateSelfManagedCitations, renumberCitations } from './citations.mjs';
import { getAllTools, constructSysPrompt } from './tools.mjs';
import { buildAssistantToolMessage, runToolCalls, toolResultsMessage, maxToolRounds } from './tool-runner.mjs';
import { logger, setCorrelationId, emitMetric } from './logger.mjs';
import { MAX_STREAM_RETRIES, isTransientError, retryDelayMs, sleep } from './retry.mjs';
import { createConnection, postRaw } from './connection.mjs';
import { readModelStream } from './stream-turn.mjs';
import {
  MAX_ESTIMATED_TOKENS, COMPRESSION_THRESHOLD, MAX_COMPACTION_ROUNDS,
  estimateTokens, rebuildDocumentIndexMap, summarizeHistory, trimDocumentBlocks,
  generateHandoffSummary, formatContextOverflowMessage, isContextOverflowError,
} from './compaction.mjs';
import {
  sanitizeSourcesForStorage, buildStoredMetadata, writeResponseTrace, saveSessionEntry,
  writeDisconnectMarker, loadAuthoritativeSession, persistContextSummary,
} from './persistence.mjs';

export { isTransientError, retryDelayMs, rebuildDocumentIndexMap };

const lambdaClient = new LambdaClient({});

/** Shown as the answer when a request exhausts MAX_TOOL_ROUNDS. */
const TOOL_ROUND_CAP_MESSAGE =
  "I searched through a lot of material but couldn't finish putting together a complete answer to this question. " +
  "Please try a narrower question (for example, one document, record, or topic at a time), or split it into smaller parts.";

/**
 * Maximum allowed length for an incoming user message (characters).
 * 10K chars is roughly 2.5K tokens -- generous for natural-language questions
 * but prevents abuse (e.g., pasting entire documents into the chat input).
 */
const MAX_MESSAGE_LENGTH = 10_000;

/** Prior exchanges loaded into the prompt; compaction covers anything larger. */
const HISTORY_WINDOW = 12;

const TITLE_PROMPT =
  "Generate a short title (3-8 words) summarizing the USER's question topic. Rules: output ONLY the title, no quotes, no explanation, no apologies. Focus on what the user is asking about, not the assistant's response. Examples: 'Parental Leave Policy Questions', 'Office Hours by Location', 'Expense Report Deadlines'.";

/**
 * Validate the WebSocket frame. Sends the error frame and returns null when
 * the request can't proceed.
 *
 * @returns {Promise<{userMessage: string, sessionId: string}|null>}
 */
async function validateRequest(id, requestJSON, userId) {
  const data = requestJSON?.data;
  if (!data || typeof data !== 'object') {
    await postRaw(id, "<!ERROR!>: Invalid request format.");
    return null;
  }
  const userMessage = data.userMessage;
  const sessionId = data.session_id;
  setCorrelationId(sessionId ?? "");

  let error = null;
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    error = "<!ERROR!>: Message must be a non-empty string.";
  } else if (userMessage.length > MAX_MESSAGE_LENGTH) {
    error = `<!ERROR!>: Message exceeds the ${MAX_MESSAGE_LENGTH.toLocaleString()}-character limit.`;
  } else if (!userId) {
    error = "<!ERROR!>: Unauthorized.";
  } else if (!sessionId) {
    error = "<!ERROR!>: Missing session_id.";
  }
  if (error) {
    await postRaw(id, error);
    return null;
  }
  return { userMessage, sessionId };
}

/**
 * Build the model history: the last HISTORY_WINDOW stored exchanges plus the
 * new message, with any persisted compaction summary prepended so the model
 * keeps context that was compacted out of stored history.
 */
function initialHistory(claude, lastMessages, userMessage, storedSummary) {
  const history = claude.assembleHistory(lastMessages, userMessage);
  if (!storedSummary) return history;
  logger.info("Loaded existing context summary from DynamoDB");
  return [
    { role: "user", content: [{ type: "text", text: `[CONVERSATION SUMMARY]\n${storedSummary}` }] },
    { role: "assistant", content: [{ type: "text", text: "Understood. I have the context from our earlier conversation and will continue naturally." }] },
    ...history
  ];
}

/**
 * Tiered in-session compaction ("two-tier sliding window with recursive
 * summarization", as in LangChain ConversationSummaryBufferMemory and Claude
 * Code auto-compact). Each round is more aggressive than the last:
 *   Round 1: keep last 4 messages verbatim, summarize the rest.
 *   Round 2: keep last 2 verbatim, re-summarize, and trim tool-result
 *            document blocks over 5K chars.
 *   Round 3: keep last 2 verbatim and empty ALL tool-result document blocks.
 * The current question is pinned at the top through every round.
 * Updates `turn` in place.
 */
async function compactIfNeeded(turn, ctx) {
  while (turn.estimatedTokens > COMPRESSION_THRESHOLD && turn.compactionRounds < MAX_COMPACTION_ROUNDS) {
    const round = turn.compactionRounds + 1;
    logger.info("Compacting context", { round, estimatedTokens: turn.estimatedTokens });
    try {
      const result = await summarizeHistory(turn.history, ctx.conn.sendStatus, {
        keepLastN: round === 1 ? 4 : 2,
        userGoal: ctx.userMessage,
      });
      if (result) {
        turn.history = result.compressedHistory;
        turn.contextSummary = result.summaryText;
        // Surviving document blocks moved; re-align citation indices.
        turn.documentIndexMap = rebuildDocumentIndexMap(turn.history, turn.sources);
      }
    } catch (compressErr) {
      logger.error("Compaction round failed", { round, error: compressErr?.message });
      // Fall through to in-place document trimming for this round.
    }
    if (round >= 2) trimDocumentBlocks(turn.history, round === 2 ? 5000 : 0);

    turn.compactionRounds = round;
    turn.estimatedTokens = estimateTokens(ctx.systemPrompt, turn.history, ctx.tools);
    logger.info("Compaction round complete", { round, estimatedTokens: turn.estimatedTokens });

    // Persist the running summary mid-loop too, so a page refresh after a
    // very long turn still resumes from the latest compaction.
    if (turn.contextSummary) {
      try {
        await persistContextSummary(ctx.userId, ctx.sessionId, turn.contextSummary);
      } catch (sumErr) {
        logger.warn("Mid-loop summary persist failed", { error: sumErr?.message });
      }
    }
  }
}

/**
 * The conversation no longer fits: emit an inline assistant note (saved in
 * the session, not an error frame) with a handoff brief the user can paste
 * into a new chat. Falls back to a plain notice if the brief fails.
 */
async function emitContextOverflow(turn, ctx) {
  await ctx.conn.sendStatus("Preparing handoff summary...");
  const handoffBrief = await generateHandoffSummary({
    userGoal: ctx.userMessage,
    currentMessage: ctx.userMessage,
    contextSummary: turn.contextSummary,
    lastMessages: ctx.lastMessages,
  });
  const inlineNote = formatContextOverflowMessage(handoffBrief);
  await ctx.conn.trySend(inlineNote, "Inline-note");
  turn.modelResponse = inlineNote;
}

/**
 * Handle a transient model error: wait with backoff and return true to
 * retry, or send the terminal error frame and return false once the
 * per-round retry budget is spent.
 */
async function retryAfterTransientError(error, turn, ctx) {
  if (turn.streamRetries >= MAX_STREAM_RETRIES) {
    logger.error("Transient error, retries exhausted", { name: error?.name, attempts: turn.streamRetries });
    await ctx.conn.sendErrorFrame();
    return false;
  }
  const delayMs = retryDelayMs(turn.streamRetries);
  turn.streamRetries++;
  logger.warn("Transient error, retrying", { name: error?.name, attempt: turn.streamRetries, max: MAX_STREAM_RETRIES, delayMs });
  await sleep(delayMs);
  return true;
}

/**
 * Open the model stream. Returns the stream, or "retry" / "stop" when the
 * call failed (context overflow becomes a handoff note; transient errors
 * retry; anything else sends the error frame).
 */
async function openStream(turn, ctx) {
  try {
    return await ctx.claude.getStreamedResponse(ctx.systemPrompt, turn.history, ctx.tools, ctx.conn.signal);
  } catch (modelError) {
    logger.error("Model invocation failed", { error: modelError?.message, name: modelError?.name });
    if (isContextOverflowError(modelError)) {
      await emitContextOverflow(turn, ctx);
      return "stop";
    }
    // Throttles usually surface here, before any stream exists.
    if (isTransientError(modelError) && await retryAfterTransientError(modelError, turn, ctx)) {
      return "retry";
    }
    await ctx.conn.sendErrorFrame();
    return "stop";
  }
}

/**
 * Run one round of tool calls and append the assistant tool_use message and
 * the tool results to history. Returns "stop" when the round cap is hit.
 */
async function runToolRound(response, turn, ctx) {
  turn.toolRoundCount += 1;
  if (turn.toolRoundCount > ctx.maxToolRounds) {
    // Logged for ops visibility; the user gets a clear next step as the
    // answer (replacing any pre-tool text already shown).
    logger.error("Exceeded MAX_TOOL_ROUNDS", { toolRoundCount: turn.toolRoundCount, MAX_TOOL_ROUNDS: ctx.maxToolRounds });
    await ctx.conn.trySend("!<|REPLACE|>!" + TOOL_ROUND_CAP_MESSAGE, "Round-cap message");
    turn.modelResponse = TOOL_ROUND_CAP_MESSAGE;
    return "stop";
  }
  logger.info("Tool round", { calls: response.toolCalls.length, round: turn.toolRoundCount, max: ctx.maxToolRounds });

  const { message, calls } = buildAssistantToolMessage(response.toolCalls, response.text);
  turn.history.push(message);

  if (calls.length === 1 && calls[0].parsedInput === null) {
    turn.history.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: calls[0].id,
        content: "Error: could not process the tool input. Please respond to the user without using tools."
      }]
    });
    return "continue";
  }

  const state = { sources: turn.sources, documentIndexMap: turn.documentIndexMap };
  const toolResults = await runToolCalls(calls, {
    knowledgeBase: ctx.knowledgeBase,
    kbId: process.env.KB_ID,
    indexes: ctx.indexes,
    state,
    sendStatus: ctx.conn.sendStatus,
  });
  turn.sources = state.sources;
  turn.documentIndexMap = state.documentIndexMap;
  turn.history.push(toolResultsMessage(toolResults));

  // Clear any intermediate (pre-tool) text streamed this round so it doesn't
  // sit in front of the final answer; the next iteration streams fresh.
  if (response.text.length > 0) {
    await ctx.conn.trySend("!<|REPLACE|>!", "Reset");
  }
  await ctx.conn.sendStatus("Reading through the results...");
  // This round succeeded; the next model call gets a fresh retry budget.
  turn.streamRetries = 0;
  return "continue";
}

/**
 * Final answer: convert citations to [N] markers, renumber them, and replace
 * the raw streamed text with the finalized version in a single frame.
 */
async function finalizeAnswer(response, turn, ctx) {
  let text = response.text;
  if (text.length > 0) {
    if (response.citations.length > 0) {
      const anchored = response.citations.map(({ blockIndex, citation }) => ({
        textOffset: response.blockEnds.get(blockIndex) ?? text.length,
        citation,
      }));
      text = insertCitationMarkers(text, anchored, turn.documentIndexMap, turn.sources);
    } else if (turn.sources.length > 0) {
      text = validateSelfManagedCitations(text, turn.sources);
    }
    const renumbered = renumberCitations(text, turn.sources);
    text = renumbered.text;
    turn.sources = renumbered.sources;
    try {
      await ctx.conn.send("!<|REPLACE|>!" + text);
    } catch (err) {
      logger.error("Error flushing final answer", { error: err?.message });
    }
  }
  turn.modelResponse = text;
}

/**
 * A stream failed mid-response. Returns "stop" or "retry".
 */
async function handleStreamError(error, streamedChars, turn, ctx) {
  // Client deliberately stopped: the Bedrock stream was aborted on purpose.
  // Stop cleanly — never log it as a failure or send an error frame. (A
  // network drop does not abort: the stream keeps flowing with sends
  // suppressed, so errors here while gone-but-not-stopped are real.)
  if ((ctx.conn.gone && ctx.conn.stopped) || error?.name === 'AbortError') {
    logger.info("Stream cancelled by client disconnect", { partialChars: streamedChars });
    return "stop";
  }
  logger.error("Stream processing error", { error: error?.message, name: error?.name });
  if (!isTransientError(error)) {
    logger.error("Non-transient error, not retrying", { name: error?.name, message: error?.message });
    await ctx.conn.sendErrorFrame();
    return "stop";
  }
  if (!(await retryAfterTransientError(error, turn, ctx))) return "stop";
  // The retry re-streams this response from the start: clear the partial
  // text already shown so it isn't rendered twice.
  if (streamedChars > 0) await ctx.conn.trySend("!<|REPLACE|>!", "Reset");
  return "retry";
}

/**
 * One loop iteration: compact if needed, stream a response, then run tools
 * or finalize. Returns "continue" to loop again, or "stop".
 */
async function agentStep(turn, ctx) {
  logger.info("Starting stream", { attempt: turn.streamRetries });
  turn.estimatedTokens = estimateTokens(ctx.systemPrompt, turn.history, ctx.tools);
  await compactIfNeeded(turn, ctx);

  // Final safety net: still over the hard limit after every compaction round.
  if (turn.estimatedTokens > MAX_ESTIMATED_TOKENS) {
    logger.error("Context still too large after all compaction rounds", { estimatedTokens: turn.estimatedTokens, compactionRounds: turn.compactionRounds });
    await emitContextOverflow(turn, ctx);
    return "stop";
  }

  // Client deliberately left (stop button / closed tab): don't spend another
  // Bedrock call. A network drop (gone but not stopped) keeps going so the
  // answer can be finished and saved.
  if (ctx.conn.gone && ctx.conn.stopped) return "stop";

  const stream = await openStream(turn, ctx);
  if (stream === "retry") return "continue";
  if (stream === "stop") return "stop";

  let streamedChars = 0;
  try {
    const response = await readModelStream(stream, ctx.claude, {
      onText: async (delta) => {
        streamedChars += delta.length;
        // Raw delta renders live; the citation-finalized text replaces it at
        // end_turn in one !<|REPLACE|>! frame.
        await ctx.conn.trySend(delta, "Delta");
      },
      onHeartbeat: () => ctx.conn.sendStatus("Composing answer…"),
    });
    if (response.stopReason === "tool_use") {
      return await runToolRound(response, turn, ctx);
    }
    // end_turn, max_tokens (a partial answer beats none), etc.
    await finalizeAnswer(response, turn, ctx);
    return "stop";
  } catch (error) {
    return (await handleStreamError(error, streamedChars, turn, ctx)) === "retry" ? "continue" : "stop";
  }
}

/**
 * Trace the turn, send EOF + metadata, and release the client. Returns the
 * metadata object (with live presigned URIs) for the stored entry.
 */
async function deliverTurn(turn, ctx, messageId, turnIndex) {
  try {
    await writeResponseTrace({
      messageId,
      sessionId: ctx.sessionId,
      turnIndex,
      userPrompt: ctx.userMessage,
      finalAnswer: turn.modelResponse,
      // Presigned URIs expire and embed role credentials; never persist them.
      sources: sanitizeSourcesForStorage(turn.sources),
      promptVersionId: ctx.promptConfig.promptVersionId,
      promptTemplateHash: ctx.promptConfig.promptTemplateHash,
      modelId: ctx.claude.modelId,
      guardrailId: process.env.GUARDRAIL_ID || "",
      userId: ctx.userId,
    });
  } catch (traceError) {
    logger.error("Failed to persist response trace", { error: traceError?.message });
  }
  const metadata = {
    Sources: turn.sources,
    Trace: {
      messageId,
      sessionId: ctx.sessionId,
      promptVersionId: ctx.promptConfig.promptVersionId,
      promptTemplateHash: ctx.promptConfig.promptTemplateHash,
      turnIndex,
    },
    ContextUsage: {
      estimatedTokens: turn.estimatedTokens,
      maxTokens: MAX_ESTIMATED_TOKENS,
      percent: Math.min(100, Math.max(0, Math.round((turn.estimatedTokens / MAX_ESTIMATED_TOKENS) * 100))),
      compactionRounds: turn.compactionRounds,
    },
  };
  // Send end-of-stream + metadata, then release the client right away: the
  // remaining work (FAQ classification, title, session save) is server-side
  // and must not hold the socket open (a slow step there used to leave the
  // UI stuck on the stop button).
  try {
    await ctx.conn.send("!<|EOF_STREAM|>!");
    await ctx.conn.send(JSON.stringify(metadata));
  } catch (e) {
    logger.error("Error sending EOF_STREAM and sources", { error: e?.message });
  }
  await ctx.conn.close();
  return metadata;
}

/** Fire-and-forget FAQ classification for analytics. */
async function classifyQuestion(ctx) {
  if (!process.env.FAQ_CLASSIFIER_FUNCTION) return;
  try {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.FAQ_CLASSIFIER_FUNCTION,
      InvocationType: 'Event',
      Payload: JSON.stringify({
        userMessage: ctx.userMessage,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        displayName: ctx.displayName,
        timestamp: new Date().toISOString(),
      }),
    }));
  } catch (classifyErr) {
    logger.error("FAQ classification fire-and-forget failed", { error: classifyErr?.message });
  }
}

/** Short session title from the first question (fast model). */
async function generateTitle(userMessage) {
  try {
    const titleModel = new ClaudeModel(process.env.FAST_MODEL_ID);
    const title = (await titleModel.getResponse(TITLE_PROMPT, [], `User: ${userMessage}`, { maxTokens: 15 }))
      .replaceAll(`"`, '').trim();
    return title.length > 80 ? userMessage.substring(0, 75).trim() : title;
  } catch (titleError) {
    logger.error("Title generation failed", { error: titleError?.message });
    return userMessage.substring(0, 50);
  }
}

/**
 * Append the turn to the session row and persist the compaction summary.
 * The client already has the answer, so a failed save can't be shown in the
 * UI; it is logged at error level and counted as the SessionSaveFailures
 * metric so an alarm catches lost turns.
 */
async function saveTurn(turn, ctx, metadata, turnIndex) {
  const title = ctx.isFirstTurn ? await generateTitle(ctx.userMessage) : "";
  const newChatEntry = {
    user: ctx.userMessage,
    chatbot: turn.modelResponse || "I'm sorry, I was unable to generate a response. Please try again.",
    metadata: buildStoredMetadata(metadata),
  };
  const saveFailure = await saveSessionEntry(new InvokeCommand({
    FunctionName: process.env.SESSION_HANDLER,
    Payload: JSON.stringify({
      body: JSON.stringify({
        operation: "append_chat_entry",
        user_id: ctx.userId,
        session_id: ctx.sessionId,
        new_chat_entry: newChatEntry,
        title,
      })
    }),
  }));
  if (saveFailure) {
    logger.error("Session save failed; this turn will be missing on reload", {
      sessionId: ctx.sessionId,
      turnIndex,
      ...saveFailure,
    });
    emitMetric("SessionSaveFailures");
  }

  if (turn.contextSummary) {
    try {
      await persistContextSummary(ctx.userId, ctx.sessionId, turn.contextSummary);
      logger.info("Context summary persisted to DynamoDB");
    } catch (sumErr) {
      logger.error("Failed to save context summary", { error: sumErr?.message });
    }
  }
}

/**
 * After the loop: discard on a deliberate stop; otherwise surface an empty
 * answer, deliver EOF + metadata, then classify, title and save.
 */
async function finishTurn(turn, ctx) {
  // Deliberate stop: persist nothing (a stopped answer must never reappear
  // on reload) and skip sends that would only hit a dead connection.
  if (ctx.conn.gone && ctx.conn.stopped) {
    logger.info("Request cancelled by client; discarding partial and skipping save");
    return;
  }
  // Network drop: the answer was generated with sends suppressed; fall
  // through so it's traced and saved and a reload shows the full exchange.
  if (ctx.conn.gone) {
    logger.info("Connection dropped mid-stream; saving completed answer for reload", {
      chars: (turn.modelResponse || "").length,
    });
  }
  // No model text at all (empty content, guardrail, refusal) and no inline
  // note: without an error frame the UI would sit on "Thinking..." forever.
  if (!(turn.modelResponse || "").trim()) {
    logger.error("Streaming loop produced no model output", {
      toolRoundCount: turn.toolRoundCount, compactionRounds: turn.compactionRounds, errorFrameSent: ctx.conn.errorFrameSent,
    });
    // A failure above already told the user; sendErrorFrame won't send twice.
    await ctx.conn.sendErrorFrame(
      "<!ERROR!>: I'm sorry, I wasn't able to generate a response for that question. Please try again or rephrase your question."
    );
  }

  const messageId = randomUUID();
  const turnIndex = ctx.storedHistory.length + 1;
  const metadata = await deliverTurn(turn, ctx, messageId, turnIndex);
  await classifyQuestion(ctx);
  await saveTurn(turn, ctx, metadata, turnIndex);
}

/** Record a failed request and tell the user, unless they were already told. */
async function reportUnhandledError(error, id, requestJSON, authorizedUserId, conn) {
  logger.error("Unhandled error in getUserResponse", { error: error?.message, stack: error?.stack });
  try {
    await writeResponseTrace({
      messageId: randomUUID(),
      sessionId: requestJSON?.data?.session_id || "unknown",
      turnIndex: 0,
      userPrompt: requestJSON?.data?.userMessage || "",
      finalAnswer: "",
      sources: [],
      promptVersionId: "error",
      promptTemplateHash: "",
      modelId: "",
      guardrailId: "",
      userId: authorizedUserId,
    });
  } catch (traceErr) {
    logger.error("Failed to write error trace", { error: traceErr?.message });
  }
  if (conn?.errorFrameSent) return;
  try {
    await postRaw(id, "<!ERROR!>: I'm sorry, something went wrong. Please try again or rephrase your question.");
  } catch (sendErr) {
    logger.warn("Final error send failed", { error: sendErr?.message });
  }
}

/**
 * Core chat handler: validates the incoming request, runs the agentic
 * tool-use loop against Bedrock, streams the response over WebSocket,
 * and persists the conversation turn.
 *
 * 1. **Validate** -- required fields, message length (validateRequest).
 * 2. **Assemble history** -- authoritative stored turns plus any persisted
 *    compaction summary (initialHistory).
 * 3. **Agentic loop** -- agentStep until it returns "stop": compact if
 *    needed, stream a response, then run a tool round or finalize the answer;
 *    transient errors retry with backoff.
 * 4. **Finish** -- trace, EOF + metadata, release the client, then FAQ
 *    classification, title (first turn) and session save (finishTurn).
 *
 * @param {string} id - WebSocket connection ID from API Gateway.
 * @param {Object} requestJSON - Parsed WebSocket message body.
 * @param {Object} requestJSON.data - Payload containing userMessage and
 *   session_id. Identity fields in the body (user_id, display_name) and any
 *   client-supplied chatHistory are ignored: identity comes from the
 *   authorizer and prior turns are loaded authoritatively from DynamoDB.
 * @param {string|null} authorizedUserId - JWT-verified user id from the authorizer.
 * @param {string} [authorizedDisplayName] - Display name from authorizer claims.
 * @returns {Promise<void>} Resolves when the full response has been streamed
 *   and the session has been saved. Errors are caught internally and sent
 *   to the client as <!ERROR!> frames.
 */
const getUserResponse = async (id, requestJSON, authorizedUserId, authorizedDisplayName = "") => {
  let conn = null;
  try {
    // Trust only the JWT-verified principal from the WS authorizer ($connect);
    // a client cannot impersonate another user by changing a body field.
    const userId = authorizedUserId;
    const request = await validateRequest(id, requestJSON, userId);
    if (!request) return;
    const { userMessage, sessionId } = request;

    // SECURITY: never trust data.chatHistory from the WebSocket frame -- it
    // is attacker-controlled and could forge prior assistant turns. Prior
    // turns come only from the session row stored under the JWT-verified
    // userId + sessionId.
    const { history: storedHistory, contextSummary: storedSummary } =
      await loadAuthoritativeSession(userId, sessionId);

    const knowledgeBase = new BedrockAgentRuntimeClient({});
    if (!process.env.KB_ID) {
      throw new Error("Knowledge Base ID is not found.");
    }

    const claude = new ClaudeModel();
    const lastMessages = storedHistory.slice(-HISTORY_WINDOW);
    const promptConfig = await constructSysPrompt();
    const { tools, indexes } = await getAllTools();
    conn = createConnection(id);

    const ctx = {
      id, conn, claude, knowledgeBase, promptConfig, tools, indexes,
      systemPrompt: promptConfig.promptText,
      userMessage, userId, sessionId,
      // Display name comes from verified token claims, never the request body.
      displayName: authorizedDisplayName,
      storedHistory, lastMessages,
      isFirstTurn: storedHistory.length === 0,
      maxToolRounds: maxToolRounds(),
    };
    const turn = {
      history: initialHistory(claude, lastMessages, userMessage, storedSummary),
      sources: [],
      documentIndexMap: [],
      contextSummary: null,
      compactionRounds: 0,
      estimatedTokens: 0,
      streamRetries: 0,
      toolRoundCount: 0,
      modelResponse: "",
    };

    while ((await agentStep(turn, ctx)) === "continue") {
      // agentStep did the work; loop until it says stop.
    }
    await finishTurn(turn, ctx);
  } catch (error) {
    await reportUnhandledError(error, id, requestJSON, authorizedUserId, conn);
  }
};

/**
 * Human-readable name for analytics, from the WS authorizer context (which
 * copies verified ID-token claims). Prefers the `name` claim, then `email`,
 * then the Cognito username; never reads the client-sent body.
 *
 * @param {Object} authorizer - event.requestContext.authorizer
 * @returns {string}
 */
export function authorizedDisplayName(authorizer) {
  const candidates = [authorizer?.name, authorizer?.email, authorizer?.cognito_username];
  const found = candidates.find((v) => typeof v === "string" && v.trim());
  return found ? found.trim().slice(0, 200) : "";
}

/**
 * Lambda handler for the WebSocket API Gateway integration.
 *
 * Routes:
 *   - $connect: no-op (connection lifecycle managed by APIGW).
 *   - $disconnect: records a clean-close marker so an in-flight streaming
 *     invocation can tell a deliberate stop from a silent network drop.
 *   - getChatbotResponse: delegates to {@link getUserResponse}.
 *   - $default: catch-all (returns a default action string).
 *
 * @param {Object} event - API Gateway WebSocket event.
 * @returns {Promise<{statusCode: number}>}
 */
export const handler = async (event) => {
  if (!event.requestContext) {
    return { statusCode: 200 };
  }
  const connectionId = event.requestContext.connectionId;
  const routeKey = event.requestContext.routeKey;
  let body = {};
  try {
    if (event.body) {
      body = JSON.parse(event.body);
    }
  } catch (err) {
    logger.error("Failed to parse request body", { error: err?.message });
  }
  logger.info("WebSocket route", { routeKey });

  switch (routeKey) {
    case '$connect':
      logger.info("WebSocket connect", { connectionId });
      return { statusCode: 200 };
    case '$disconnect':
      logger.info("WebSocket disconnect", {
        connectionId,
        statusCode: event.requestContext.disconnectStatusCode,
        reason: event.requestContext.disconnectReason,
      });
      // Marker tells an in-flight streaming invocation this was a clean
      // client close (deliberate stop) rather than a silent network drop.
      await writeDisconnectMarker(connectionId);
      return { statusCode: 200 };
    case '$default':
      return { 'action': 'Default Response Triggered' };
    case "getChatbotResponse": {
      // Pull the JWT-verified identifier from the WS authorizer context that
      // ran at $connect (API Gateway propagates it to every route on the
      // connection). Prefer `cognito_username` because chat rows are keyed
      // off it (matches Amplify's `.username`); fall back to `principalId`
      // (the JWT `sub`).
      const authorizer = event.requestContext.authorizer || {};
      const authorizedUserId = authorizer.cognito_username || authorizer.principalId || null;
      await getUserResponse(connectionId, body, authorizedUserId, authorizedDisplayName(authorizer));
      return { statusCode: 200 };
    }
    default:
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "The requested route is not recognized."
        })
      };
  }
};
