/**
 * @module stream-turn
 *
 * Reads one streamed Bedrock response into text, tool calls and citations.
 */

/**
 * The frontend's WebSocket hook treats ~90s of silence as a stalled request.
 * While the model is still deciding on tools (no answer text yet) a status
 * heartbeat goes out this often to keep the socket alive.
 */
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Consume a Bedrock response stream.
 *
 * Text deltas are handed to `onText` as they arrive so the answer renders
 * live. Claude streams each cited claim as its own text content block and
 * sends that block's citations before its text, so citations are recorded
 * with their block index and `blockEnds` gives each block's end offset in
 * `text`, which is where the marker belongs (see insertCitationMarkers).
 *
 * @param {AsyncIterable} stream - Bedrock response body.
 * @param {{parseChunk: (chunk: object) => object|null}} model
 * @param {object} callbacks
 * @param {(delta: string) => Promise<void>} callbacks.onText - Live text delta.
 * @param {() => Promise<void>} callbacks.onHeartbeat - Keep-alive while no text yet.
 * @returns {Promise<{
 *   text: string,
 *   toolCalls: Array<{id: string, name: string, inputJson: string}>,
 *   citations: Array<{blockIndex: number, citation: object}>,
 *   blockEnds: Map<number, number>,
 *   stopReason: string|null,
 * }>}
 */
export async function readModelStream(stream, model, { onText, onHeartbeat }) {
  let text = "";
  let stopReason = null;
  const citations = [];
  const blockEnds = new Map();
  // Claude can batch several tool calls in one response: each arrives as a
  // tool_use block start followed by input_json_delta fragments.
  const pendingTools = new Map();
  let lastStatusSentAt = Date.now();

  for await (const event of stream) {
    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
    const parsed = await model.parseChunk(chunk);
    if (!parsed) continue;

    if (parsed.stop_reason) {
      stopReason = parsed.stop_reason;
      continue;
    }
    if (parsed.type === "tool_use") {
      pendingTools.set(parsed.index, { id: parsed.id, name: parsed.name, inputJson: "" });
      continue;
    }

    if (parsed.kind === "tool_input" && parsed.json != null) {
      const entry = pendingTools.get(parsed.index);
      if (entry) entry.inputJson += parsed.json;
    } else if (parsed.kind === "text") {
      text += parsed.text;
      blockEnds.set(parsed.index, text.length);
      if (parsed.text) await onText(parsed.text);
    } else if (parsed.kind === "citation") {
      citations.push({ blockIndex: parsed.index, citation: parsed.citation });
    }

    // Once text is streaming the deltas keep the socket alive; skip the
    // heartbeat then so a status pill doesn't flicker over the answer.
    if (text.length === 0 && Date.now() - lastStatusSentAt > HEARTBEAT_INTERVAL_MS) {
      lastStatusSentAt = Date.now();
      await onHeartbeat();
    }
  }

  return { text, toolCalls: [...pendingTools.values()], citations, blockEnds, stopReason };
}
