/**
 * useWebSocketChat -- React hook for streaming chat over a WebSocket.
 *
 * Opens a one-shot WebSocket to the API Gateway `$default` stage, sends
 * the user message via the `getChatbotResponse` action, and streams the
 * response back through a series of callback props.
 *
 * ## Wire protocol
 *
 * The Lambda handler sends frames as plain-text strings. Sentinel prefixes
 * distinguish control frames from content:
 *
 *  - `STATUS_PREFIX` (`!<|STATUS|>!`)  -- followed by a human-readable
 *    status string (e.g. "Searching knowledge base..."). The UI shows
 *    this as a progress indicator while the agentic loop is running.
 *
 *  - `REPLACE_PREFIX` (`!<|REPLACE|>!`) -- the text after it replaces the
 *    accumulated answer wholesale: the citation-finalized version at end of
 *    stream, or an empty payload to clear intermediate tool-round text. Plain
 *    (non-sentinel) frames before it stream in as deltas and are appended.
 *
 *  - `EOF_MARKER` (`!<|EOF_STREAM|>!`) -- signals the end of the
 *    assistant's text. Everything received *after* this marker is
 *    treated as JSON metadata (sources / citations).
 *
 *  - `ERROR_PREFIX` (`<!ERROR!>:`)     -- followed by an error message.
 *    The connection is closed immediately after.
 *
 * The metadata frame after `EOF_MARKER` is JSON shaped as
 * `{ Sources, Trace, ContextUsage }` and is forwarded whole to `onSources`.
 *
 * ## Reconnection strategy
 *
 * If the socket closes unexpectedly (code other than 1000/1001) before
 * the `EOF_MARKER` is received, the hook retries up to
 * `MAX_RECONNECT_ATTEMPTS` (3) times with exponential back-off
 * (1 s, 2 s, 4 s). Each retry re-authenticates before opening the socket.
 *
 * ## Cancellation
 *
 * Every `send` gets its own request token. `abort()` (the Stop button), a new
 * `send`, or unmounting the component that owns the hook cancels the current
 * token: the socket closes, a pending reconnect timer is cleared, and no
 * callback of the cancelled request fires afterwards. Call the hook once per
 * chat and share `send`/`abort`: two hook instances would each own a separate
 * socket, so Stop in one could never reach the other's connection.
 *
 * ## Completion
 *
 * The response is complete as soon as the `EOF_MARKER` and the trailing
 * metadata frame have arrived; we then report completion and close the socket
 * ourselves (see `finalize`). We do NOT wait for the server to close the
 * connection, because the backend holds the socket open while it does
 * post-response work (title generation, session save).
 *
 * ## Timeout
 *
 * A 120-second inactivity timer (`TIMEOUT_MS`) runs until EOF. If no frame
 * arrives within that window the socket is closed and the user sees a timeout
 * error. The timer is polled every 5 seconds.
 */
import { useRef, useCallback, useContext, useEffect } from "react";
import { AppContext } from "../common/app-context";
import { Utils } from "../common/utils";
import { ChatBotHistoryItem } from "../components/chatbot/types";
import { assembleHistory } from "../components/chatbot/utils";

/** Prefix for status/progress frames sent during the agentic tool-use loop. */
const STATUS_PREFIX = "!<|STATUS|>!";
/** Marks the end of the assistant's streamed text; metadata follows. */
const EOF_MARKER = "!<|EOF_STREAM|>!";
/** Replaces the accumulated answer text wholesale. */
const REPLACE_PREFIX = "!<|REPLACE|>!";
/** Prefix for error frames; the socket is closed immediately after. */
const ERROR_PREFIX = "<!ERROR!>:";
/** Inactivity timeout (ms) before the request is considered stalled. */
const TIMEOUT_MS = 120_000;
/** How often the inactivity timer is checked. */
const TIMEOUT_POLL_MS = 5_000;
/** Grace window (ms) after EOF to collect trailing metadata before completing. */
const FINALIZE_GRACE_MS = 1_000;
/** Maximum number of automatic reconnection attempts on unexpected close. */
const MAX_RECONNECT_ATTEMPTS = 3;
/** Base delay (ms) for exponential back-off between reconnection attempts. */
const RECONNECT_BASE_DELAY_MS = 1_000;

/** Represents the current streaming progress indicator shown in the UI. */
export interface StreamingStatus {
  /** Human-readable status text (e.g. "Searching knowledge base..."), or empty when idle. */
  text: string;
  /** True while the agentic loop is actively processing (spinner visible). */
  active: boolean;
}

/** Raw source entry as sent by the backend (legacy or current shape). */
interface RawSource {
  chunkIndex?: number | null;
  title?: string;
  uri?: string | null;
  [key: string]: unknown;
}

export type ResponseMetadata = Record<string, unknown> & { Sources?: unknown[] };

/** Options passed to the `send` function to initiate a chat request. */
export interface SendOptions {
  /** The user's message text. */
  userMessage: string;
  /** Cognito user ID for session attribution. */
  userId: string;
  /** Chat session ID used to maintain conversation continuity. */
  sessionId: string;
  /** Full conversation history; the last entries are sent as context. */
  messageHistory: ChatBotHistoryItem[];
  /** Retrieval source hint (defaults to "kb" for Knowledge Base). */
  retrievalSource?: string;
  /** Called on each text frame with the *accumulated* response so far. */
  onStreamChunk: (accumulated: string) => void;
  /** Called when the backend sends a status update or clears the status. */
  onStatusChange: (status: StreamingStatus) => void;
  /** Called once after EOF with parsed citation/source metadata. */
  onSources: (sources: ResponseMetadata) => void;
  /** Called on successful completion; `firstMessage` is true for new sessions. */
  onComplete: (firstMessage: boolean) => void;
  /** Called on any error (timeout, auth failure, server error). */
  onError: (message: string) => void;
}

export type SendChatMessage = (opts: SendOptions) => Promise<void>;

/** Per-request cancellation token captured by every closure of one `send`. */
interface RequestToken {
  cancelled: boolean;
}

/** Fill in a display title for sources the backend sent without one. */
function normalizeSources(items: RawSource[]): RawSource[] {
  return items.map((item) => {
    const fileName = item.uri ? item.uri.slice(item.uri.lastIndexOf("/") + 1) : "";
    if (!("chunkIndex" in item)) {
      return {
        chunkIndex: null,
        title: item.title || fileName || "Unknown source",
        uri: item.uri ?? null,
        excerpt: null,
        score: null,
        page: null,
        s3Key: null,
        sourceType: "knowledgeBase",
      };
    }
    return item.title === "" && fileName ? { ...item, title: fileName } : item;
  });
}

export function useWebSocketChat() {
  const appContext = useContext(AppContext);
  const wsRef = useRef<WebSocket | null>(null);
  const requestRef = useRef<RequestToken | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abort = useCallback(() => {
    if (requestRef.current) requestRef.current.cancelled = true;
    requestRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000);
    }
  }, []);

  // Leaving the chat (navigation, session switch) cancels any in-flight request.
  useEffect(() => abort, [abort]);

  /**
   * Send a chat message over a new WebSocket connection. Supersedes (cancels)
   * any request already in flight from this hook instance.
   */
  const send = useCallback<SendChatMessage>(
    async (opts) => {
      if (!appContext) {
        opts.onError("App not configured. Please refresh the page.");
        return;
      }

      abort();
      const request: RequestToken = { cancelled: false };
      requestRef.current = request;
      const settle = () => {
        if (requestRef.current === request) requestRef.current = null;
      };
      // Callbacks of a cancelled request (stopped, superseded, unmounted) are
      // dropped so they can never write into another session's state.
      const cb = {
        onStreamChunk: (text: string) => !request.cancelled && opts.onStreamChunk(text),
        onStatusChange: (status: StreamingStatus) =>
          !request.cancelled && opts.onStatusChange(status),
        onSources: (meta: ResponseMetadata) => !request.cancelled && opts.onSources(meta),
        onComplete: (first: boolean) => {
          if (request.cancelled) return;
          settle();
          opts.onComplete(first);
        },
        onError: (message: string) => {
          if (request.cancelled) return;
          settle();
          opts.onError(message);
        },
      };

      const wsUrl = appContext.wsEndpoint + "/";
      const firstMessage = opts.messageHistory.length < 3;

      // The outbound history is capped client-side by `assembleHistory` to
      // match the backend sliding window, keeping frames under API Gateway's
      // 128 KB limit. Identity (display name) is derived server-side from the
      // token claims, so the client does not send it.
      const outboundFrame = JSON.stringify({
        action: "getChatbotResponse",
        data: {
          userMessage: opts.userMessage,
          chatHistory: assembleHistory(opts.messageHistory),
          user_id: opts.userId,
          session_id: opts.sessionId,
          retrievalSource: opts.retrievalSource ?? "kb",
        },
      });

      const connect = async (attempt: number): Promise<void> => {
        reconnectTimerRef.current = null;
        if (request.cancelled) return;
        let token: string;
        try {
          token = await Utils.authenticate();
        } catch {
          cb.onError("Your session has expired. Please sign in again.");
          return;
        }
        if (request.cancelled) return;

        const ws = new WebSocket(wsUrl + "?Authorization=" + token);
        wsRef.current = ws;
        const releaseSocket = () => {
          if (wsRef.current === ws) wsRef.current = null;
        };

        let receivedData = "";
        let incomingMetadata = false;
        let responseMetadata: ResponseMetadata = {};
        let lastActivity = Date.now();
        let eofReceived = false;
        // Latched once a terminal callback (error) has fired so the following
        // close event does not re-fire onError as "connection lost".
        let terminalHandled = false;
        // Latched once the request has been completed exactly once.
        let finalized = false;
        let finalizeTimer: ReturnType<typeof setTimeout> | null = null;

        const timeoutId = setInterval(() => {
          if (!finalized && !eofReceived && Date.now() - lastActivity > TIMEOUT_MS) {
            clearInterval(timeoutId);
            terminalHandled = true;
            ws.close();
            cb.onError("The request timed out. Please try again.");
          }
        }, TIMEOUT_POLL_MS);

        const failWith = (message: string) => {
          clearInterval(timeoutId);
          terminalHandled = true;
          cb.onError(message);
          ws.close();
        };

        // Completes the request exactly once: stops timers, reports completion,
        // and closes the socket ourselves.
        const finalize = () => {
          if (finalized) return;
          finalized = true;
          clearInterval(timeoutId);
          if (finalizeTimer) clearTimeout(finalizeTimer);
          releaseSocket();
          cb.onComplete(firstMessage);
          try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close(1000);
            }
          } catch {
            // socket already closing/closed
          }
        };

        const scheduleFinalize = () => {
          if (finalized) return;
          if (finalizeTimer) clearTimeout(finalizeTimer);
          finalizeTimer = setTimeout(finalize, FINALIZE_GRACE_MS);
        };

        ws.addEventListener("open", () => {
          if (request.cancelled) return;
          ws.send(outboundFrame);
        });

        ws.addEventListener("message", (event) => {
          if (request.cancelled) return;
          const raw: string = event.data;

          try {
            const parsed = JSON.parse(raw);
            if (parsed.message === "Endpoint request timed out" && parsed.connectionId) {
              return;
            }
          } catch {
            // not a JSON gateway timeout; continue
          }

          if (raw.startsWith(ERROR_PREFIX)) {
            failWith(raw.replace(ERROR_PREFIX, "").trim());
            return;
          }

          if (raw.startsWith(STATUS_PREFIX)) {
            lastActivity = Date.now();
            cb.onStatusChange({ text: raw.slice(STATUS_PREFIX.length), active: true });
            return;
          }

          if (raw.startsWith(REPLACE_PREFIX)) {
            lastActivity = Date.now();
            receivedData = raw.slice(REPLACE_PREFIX.length);
            cb.onStatusChange({ text: "", active: false });
            cb.onStreamChunk(receivedData);
            return;
          }

          if (raw === EOF_MARKER) {
            // EOF with zero text means the model produced no output (e.g. a
            // guardrail intervention). Surface an error instead of an empty bubble.
            if (receivedData === "") {
              failWith(
                "I wasn't able to generate a response for that question. Please try again or rephrase your question."
              );
              return;
            }
            eofReceived = true;
            incomingMetadata = true;
            cb.onStatusChange({ text: "", active: false });
            scheduleFinalize();
            return;
          }

          if (!incomingMetadata) {
            lastActivity = Date.now();
            cb.onStatusChange({ text: "", active: false });
            receivedData += raw;
            cb.onStreamChunk(receivedData);
            return;
          }

          try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              responseMetadata = { Sources: normalizeSources(parsed as RawSource[]) };
            } else if (parsed && typeof parsed === "object") {
              const obj = parsed as ResponseMetadata;
              responseMetadata = { ...obj, Sources: Array.isArray(obj.Sources) ? obj.Sources : [] };
            }
            cb.onSources(responseMetadata);
            scheduleFinalize();
          } catch {
            // ignore malformed metadata JSON
          }
        });

        ws.addEventListener("error", () => {
          // close fires immediately after; reconnection logic lives there
        });

        ws.addEventListener("close", (event) => {
          clearInterval(timeoutId);
          if (finalizeTimer) clearTimeout(finalizeTimer);
          releaseSocket();

          // Stopped, superseded or unmounted: no reconnect, resend, completion or error.
          if (request.cancelled) return;

          if (eofReceived) {
            finalize();
            return;
          }

          // Our own ws.close() after a terminal callback is expected.
          if (terminalHandled || finalized) return;

          const isCleanClose = event.code === 1000 || event.code === 1001;
          if (!isCleanClose && attempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_BASE_DELAY_MS * 2 ** attempt;
            cb.onStatusChange({
              text: `Connection lost, reconnecting… (attempt ${attempt + 1} of ${MAX_RECONNECT_ATTEMPTS})`,
              active: true,
            });
            reconnectTimerRef.current = setTimeout(() => {
              void connect(attempt + 1);
            }, delay);
          } else {
            cb.onError("Connection lost. Please check your internet and try again.");
          }
        });
      };

      await connect(0);
    },
    [appContext, abort]
  );

  return { send, abort };
}
