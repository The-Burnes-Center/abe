/**
 * @module compaction
 *
 * Keeps a chat request inside the model's context window: token estimates,
 * tiered summarization of older history (via the context-summarizer Lambda),
 * trimming of large tool-result documents, and the handoff brief shown when
 * a conversation can't be compacted any further.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import ClaudeModel from "./models/chat-model.mjs";
import { logger } from "./logger.mjs";

const lambdaClient = new LambdaClient({});

/**
 * Hard ceiling for estimated token count before the request is aborted.
 * Set to 160K to stay safely within Claude's 200K context window after
 * accounting for output tokens (16K max) and estimation inaccuracy (~15%).
 */
export const MAX_ESTIMATED_TOKENS = 160000;

/**
 * Soft threshold (~75% of MAX_ESTIMATED_TOKENS) that triggers automatic
 * context compression via the summarizer Lambda. Compressing at 120K rather
 * than at the hard limit gives headroom to absorb the summary + remaining
 * messages without immediately hitting MAX_ESTIMATED_TOKENS.
 */
export const COMPRESSION_THRESHOLD = 120000;

/**
 * Hard cap on compaction rounds per request. Each round summarizes more
 * aggressively; by round 3 only the pinned question, the running summary,
 * and the last exchange remain. Beyond that there is nothing left to compact.
 */
export const MAX_COMPACTION_ROUNDS = 3;

/**
 * Rough token estimate using character count / 3.5. This is intentionally
 * conservative (over-estimates) since triggering compression too early is
 * cheaper than hitting the hard context limit and aborting.
 *
 * @param {string} systemPrompt - The assembled system prompt text.
 * @param {Array} history - Conversation message history (Bedrock format).
 * @param {Array} tools - Tool definition array sent to the model.
 * @returns {number} Estimated token count.
 */
export function estimateTokens(systemPrompt, history, tools) {
  const chars = systemPrompt.length + JSON.stringify(history).length + JSON.stringify(tools).length;
  return Math.ceil(chars / 3.5);
}

/** True when a message is a user turn carrying tool_result blocks. */
function startsWithToolResult(message) {
  return message?.role === "user"
    && Array.isArray(message.content)
    && message.content.some((block) => block?.type === "tool_result");
}

/**
 * Rebuild the document_index -> source map from the document blocks that
 * are actually present in `history`.
 *
 * Bedrock numbers native citations by the position of each document block
 * across the whole request. Compaction summarizes older messages away, which
 * shifts every surviving block's position, so the map built while tools ran
 * would point citations at the wrong (or a dropped) source. Blocks are
 * matched back to their source by the "Source N - ..." title they were
 * created with (N = the source's chunkIndex).
 *
 * @param {Array} history - Bedrock-format messages.
 * @param {Array<{chunkIndex: number}>} sources - All sources gathered this turn.
 * @returns {Array<object|undefined>} Sources in document-block order.
 */
export function rebuildDocumentIndexMap(history, sources) {
  const byChunkIndex = new Map(sources.map((src) => [src.chunkIndex, src]));
  const map = [];
  for (const msg of history) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block?.type !== "document") continue;
      const match = /^Source (\d+) - /.exec(block.title || "");
      map.push(match ? byChunkIndex.get(parseInt(match[1], 10)) : undefined);
    }
  }
  return map;
}

/**
 * Compress older conversation history by summarizing it via the context-summarizer Lambda.
 *
 * Implements the industry-standard "two-tier sliding window with summarization"
 * pattern (LangChain ConversationSummaryBufferMemory; Claude Code auto-compact):
 *
 *   - "toSummarize": all messages except the last `keepLastN` -- fed to the summarizer.
 *   - "toKeep": the most recent `keepLastN` messages preserved verbatim so the
 *     model retains immediate conversational context. The cut never starts
 *     on a tool_result whose tool_use would be summarized away (Bedrock
 *     rejects orphaned tool_result blocks); it moves back one message to keep
 *     the pair together.
 *   - "userGoal" (optional): the question being answered in this request,
 *     pinned at the very top of the returned history so it survives every
 *     compaction round even when the turn's own user message is summarized.
 *
 * The summary is injected as a synthetic [CONVERSATION SUMMARY] user message
 * after the optional pinned goal, giving the model condensed context from
 * earlier turns without consuming proportional token budget.
 *
 * @param {Array<{role: string, content: *}>} history - Full conversation history in Bedrock format.
 * @param {(text: string) => Promise<void>} sendStatus - Shows the "summarizing" status line.
 * @param {Object} [opts]
 * @param {number} [opts.keepLastN=4] - How many of the most recent messages to keep verbatim.
 * @param {string} [opts.userGoal] - The current user question to pin at the top of history.
 * @returns {Promise<{compressedHistory: Array, summaryText: string} | null>}
 *   The compressed history and raw summary text, or null if there are fewer
 *   than 2 messages eligible for summarization (nothing worth compressing).
 */
export async function summarizeHistory(history, sendStatus, opts = {}) {
  const keepLastN = Math.max(2, opts.keepLastN ?? 4);
  const userGoal = typeof opts.userGoal === "string" ? opts.userGoal.trim() : "";

  // Send a neutral status so the user sees the thinking indicator
  await sendStatus("Summarizing earlier messages so we can keep going\u2026");

  let cut = Math.max(0, history.length - keepLastN);
  if (cut > 0 && startsWithToolResult(history[cut])) cut -= 1;
  const toSummarize = history.slice(0, cut);
  const toKeep = history.slice(cut);

  if (toSummarize.length < 2) {
    return null;
  }

  // Build text representation of older messages for the summarizer
  const conversationText = toSummarize.map(msg => {
    const text = Array.isArray(msg.content)
      ? msg.content.map(b => b.text || b.source?.data || "").join(" ")
      : String(msg.content);
    return `${msg.role}: ${text}`;
  }).join("\n\n");

  const payload = JSON.stringify({ conversation_text: conversationText });
  const command = new InvokeCommand({
    FunctionName: process.env.CONTEXT_SUMMARIZER_FUNCTION,
    Payload: Buffer.from(payload),
  });
  const response = await lambdaClient.send(command);
  const result = JSON.parse(Buffer.from(response.Payload).toString());

  if (result.statusCode !== 200) {
    throw new Error(`Context summarizer returned ${result.statusCode}: ${result.body}`);
  }

  const body = JSON.parse(result.body);
  const summaryText = body.summary_text;

  // Pin the question being answered at the top so the model never loses it
  // through repeated compactions ("lost-in-the-middle" mitigation).
  const compressedHistory = [];
  if (userGoal) {
    compressedHistory.push(
      { role: "user", content: [{ type: "text", text: `[USER GOAL]\nThe question you are answering right now is:\n"""\n${userGoal}\n"""\nKeep this in mind as the anchoring topic.` }] },
      { role: "assistant", content: [{ type: "text", text: "Acknowledged. I'll keep this question in mind." }] }
    );
  }
  compressedHistory.push(
    { role: "user", content: [{ type: "text", text: `[CONVERSATION SUMMARY]\n${summaryText}` }] }
  );
  // Roles must alternate: when the kept tail opens with the assistant's
  // tool_use, it follows the summary directly instead of a synthetic reply.
  if (toKeep[0]?.role !== "assistant") {
    compressedHistory.push(
      { role: "assistant", content: [{ type: "text", text: "Understood. I have the context from our earlier conversation and will continue naturally." }] }
    );
  }
  compressedHistory.push(...toKeep);

  return { compressedHistory, summaryText };
}

/**
 * Shrink large tool-result document blocks in place. Row-shaped JSON keeps
 * its total_matches with rows emptied; anything else becomes a stub. Used
 * from compaction round 2 (blocks over 5K chars) and round 3 (all blocks).
 *
 * @param {Array} history - Bedrock-format messages (mutated).
 * @param {number} threshold - Blocks at or under this many chars are kept.
 */
export function trimDocumentBlocks(history, threshold) {
  for (const msg of history) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== "document" || !block.source?.data) continue;
      if (block.source.data.length <= threshold) continue;
      try {
        const parsed = JSON.parse(block.source.data);
        block.source.data = JSON.stringify({
          total_matches: parsed.total_matches,
          returned: 0,
          rows: [],
          _trimmed_by_overflow: true,
          _note: "Results trimmed to fit context. Use count_unique, group_by, or narrower filters.",
        });
      } catch (_) {
        block.source.data = '{"_trimmed_by_overflow":true,"rows":[],"returned":0}';
      }
    }
  }
}

/**
 * System prompt for the handoff-brief LLM call. Kept in module scope so it is
 * stable across invocations and easy to tweak without hunting through the
 * agentic loop.
 */
const HANDOFF_SUMMARY_SYSTEM_PROMPT = `You write concise handoff briefs that let a user resume a conversation in a fresh chat session.

Output ONLY the brief in this exact markdown shape (no preamble, no apology, no closing remarks):

**Original goal:** <one sentence describing what the user is trying to accomplish>
**Progress so far:**
- <short bullet covering what has been established or retrieved>
- <short bullet>
**Open questions / next steps:**
- <short bullet describing what to do next>
- <short bullet>
**Key context to preserve:**
- <short bullet listing specific documents, records, names, filters, or decisions the new session needs>
- <short bullet>

Rules:
- Keep the entire brief under 250 words.
- Be specific: include document names, record identifiers, names, amounts, dates, and filters that were used.
- Do NOT invent details. If something is unknown, omit the bullet.
- Do NOT mention that the previous session ran out of memory.`;

/**
 * Generate a markdown handoff brief the user can paste into a fresh chat
 * to continue where this session left off. Used when the conversation
 * context exceeds the model's window (post-compaction overflow OR Bedrock
 * ValidationException). Returns null on any failure so the caller can fall
 * back to the legacy plain-text notice without breaking the chat flow.
 *
 * Note: we deliberately call the FAST model with a small, bounded set of
 * inputs (pinned goal + running summary + the most recent chat-history
 * exchanges) instead of the full agentic-loop history, because the latter
 * is what blew the context window in the first place.
 *
 * @param {Object} params
 * @param {string} params.userGoal - The pinned question this request is answering.
 * @param {string} params.currentMessage - The latest user message.
 * @param {string|null} params.contextSummary - Latest compaction summary, if any.
 * @param {Array<{user:string, chatbot:string}>} params.lastMessages - Up to 12 prior chat entries.
 * @param {string} [params.latestAssistantText] - Most recent partial assistant text, if any.
 * @returns {Promise<string|null>} Markdown brief, or null on failure.
 */
export async function generateHandoffSummary({ userGoal, currentMessage, contextSummary, lastMessages, latestAssistantText }) {
  try {
    const fastModelId = process.env.FAST_MODEL_ID || process.env.PRIMARY_MODEL_ID;
    const fastModel = new ClaudeModel(fastModelId);

    // Build a compact transcript of the most recent exchanges. Cap each turn
    // so an unusually long single answer can't push us back over the limit.
    const TURN_CHAR_CAP = 1500;
    const recentTurns = Array.isArray(lastMessages)
      ? lastMessages.slice(-6).map((entry, i) => {
          const u = String(entry?.user ?? "").slice(0, TURN_CHAR_CAP);
          const a = String(entry?.chatbot ?? "").slice(0, TURN_CHAR_CAP);
          return `Turn ${i + 1}\nUser: ${u}\nAssistant: ${a}`;
        }).join("\n\n")
      : "";

    const inputSections = [
      `CURRENT USER QUESTION (pinned):\n${userGoal}`,
      currentMessage && currentMessage !== userGoal ? `LATEST USER MESSAGE:\n${currentMessage}` : null,
      contextSummary ? `RUNNING CONVERSATION SUMMARY (already compressed):\n${contextSummary}` : null,
      recentTurns ? `RECENT EXCHANGES (most recent last):\n${recentTurns}` : null,
      latestAssistantText ? `MOST RECENT (PARTIAL) ASSISTANT REPLY:\n${String(latestAssistantText).slice(0, 3000)}` : null,
    ].filter(Boolean).join("\n\n---\n\n");

    const brief = await fastModel.getResponse(
      HANDOFF_SUMMARY_SYSTEM_PROMPT,
      [],
      inputSections,
      { maxTokens: 600 }
    );
    const trimmed = (brief || "").trim();
    // The chat-model fallback returns an apology string on failure -- treat
    // that the same as a hard failure so we don't paste an apology into the
    // handoff message.
    if (!trimmed || /^I'm sorry/i.test(trimmed)) return null;
    return trimmed;
  } catch (err) {
    logger.error("Handoff summary generation failed", { error: err?.message });
    return null;
  }
}

/**
 * Compose the user-facing message that follows a context-overflow event.
 * Wraps the LLM-generated handoff brief with copy/paste instructions, or
 * falls back to a plain notice when the brief could not be generated.
 *
 * @param {string|null} handoffBrief - Markdown brief from generateHandoffSummary.
 * @returns {string} Markdown chat message ready to send via WebSocket.
 */
export function formatContextOverflowMessage(handoffBrief) {
  if (!handoffBrief) {
    return "I've compacted this conversation as much as I can while preserving the important parts, but it's still too large for me to continue here. To keep going on a related question, please click \"+ New chat\" in the sidebar to start a fresh conversation.";
  }
  return [
    "I've reached the memory limit for this conversation, so I can't continue here.",
    "",
    "To pick up where we left off, click **+ New chat** in the sidebar and paste the handoff brief below as your first message:",
    "",
    "---",
    "",
    handoffBrief,
    "",
    "---",
  ].join("\n");
}

/**
 * True for a Bedrock ValidationException that means the request no longer
 * fits the context window ("Input is too long for requested model", ...).
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isContextOverflowError(error) {
  const msg = (error?.message || "").toLowerCase();
  return error?.name === "ValidationException" &&
    (msg.includes("too long") || msg.includes("context") || msg.includes("max tokens") || msg.includes("input length"));
}
