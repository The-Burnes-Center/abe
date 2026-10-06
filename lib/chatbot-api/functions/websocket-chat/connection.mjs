/**
 * @module connection
 *
 * One chat request's WebSocket connection: guarded sends, status and error
 * frames, and the stop-vs-network-drop classification that decides whether
 * an interrupted answer is discarded or finished and saved.
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { hasDisconnectMarker } from './persistence.mjs';
import { logger } from './logger.mjs';

const wsConnectionClient = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_API_ENDPOINT });

/** Generic terminal error shown when the model call fails for good. */
export const GENERIC_ERROR_FRAME =
  "<!ERROR!>: I'm sorry, something went wrong processing your request. Please try again or rephrase your question.";

const isGone = (err) => err?.name === 'GoneException' || err?.$metadata?.httpStatusCode === 410;

/**
 * Send one frame without any connection bookkeeping (used for request
 * validation errors before a chat turn starts, and as a last resort).
 */
export async function postRaw(connectionId, data) {
  await wsConnectionClient.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
}

/**
 * Distinguish a deliberate stop from a dead network path after a 410.
 *
 * A clean client close produces a $disconnect within milliseconds, whose
 * handler writes a marker keyed by connection id -- but that runs as a
 * separate Lambda invocation (possibly cold-starting), so poll briefly
 * before concluding nothing is coming. Poll interval is env-overridable
 * so unit tests don't sleep.
 */
async function classifyDisconnect(connectionId) {
  const fromEnv = parseInt(process.env.STOP_MARKER_POLL_MS ?? "", 10);
  const pollMs = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 2000;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (await hasDisconnectMarker(connectionId)) return true;
  }
  return false;
}

/**
 * Create the connection wrapper for one request.
 *
 * - `gone` is a one-way latch, set when any send gets a 410 GoneException
 *   (the client disconnected). Later sends become no-ops so the turn can
 *   still finish server-side without flooding the logs.
 * - `stopped` records WHY it went away. true = deliberate client stop (a
 *   clean $disconnect arrived: stop button, tab close, refresh) -- generation
 *   is aborted via `signal` and nothing is persisted. false = the network
 *   path died without a clean close (VPN/proxy/NAT drop): the user still
 *   wants the answer, so generation continues with sends suppressed and the
 *   completed exchange is saved, where a reload will find it.
 * - `errorFrameSent` makes sure one failure produces one error frame.
 *
 * @param {string} connectionId
 */
export function createConnection(connectionId) {
  const abortController = new AbortController();
  const conn = {
    id: connectionId,
    gone: false,
    stopped: false,
    errorFrameSent: false,
    /** Aborts the in-flight Bedrock stream on a deliberate stop. */
    signal: abortController.signal,

    /**
     * Send a frame. A 410 flips `gone`, classifies the disconnect and is
     * swallowed; any other error is re-thrown for the caller to handle.
     */
    async send(data) {
      if (conn.gone) return;
      try {
        await wsConnectionClient.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (err) {
        if (!isGone(err)) throw err;
        if (conn.gone) return;
        logger.warn("Client disconnected (GoneException), suppressing further send attempts");
        conn.gone = true;
        conn.stopped = await classifyDisconnect(connectionId);
        if (conn.stopped) {
          // Deliberate stop: cancel the in-flight Bedrock stream so we stop
          // generating (and paying for) tokens nobody wants.
          abortController.abort();
        } else {
          logger.warn("No clean $disconnect for this connection; treating as a network drop and finishing the answer for session history");
        }
      }
    },

    /** Send a frame, logging (never throwing) on failure. */
    async trySend(data, what) {
      try {
        await conn.send(data);
      } catch (err) {
        logger.warn(`${what} send failed`, { error: err?.message });
      }
    },

    /** Transient status line ("Searching documents..."). Never throws. */
    sendStatus(text) {
      return conn.trySend(`!<|STATUS|>!${text}`, "Status");
    },

    /** Terminal error frame; at most one per request. */
    async sendErrorFrame(data = GENERIC_ERROR_FRAME) {
      if (conn.errorFrameSent) return;
      conn.errorFrameSent = true;
      await conn.trySend(data, "Error");
    },

    /**
     * Close the socket once the answer and metadata are out, so the browser
     * is released while server-side finalization continues.
     */
    async close() {
      if (conn.gone) return;
      try {
        await wsConnectionClient.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
        conn.gone = true;
      } catch (err) {
        // 410 means the client already closed the socket -- nothing to clean
        // up, so don't emit a "failed" line that pollutes error-grep queries.
        if (isGone(err)) {
          conn.gone = true;
        } else {
          logger.warn("Connection cleanup failed", { error: err?.message, name: err?.name });
        }
      }
    },
  };
  return conn;
}
