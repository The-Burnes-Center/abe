import {
  ChatBotHistoryItem,
  ChatBotMessageType,
  ChatMessageMetadata,
} from "../../components/chatbot/types";

import { Utils } from "../utils";

import { AppConfig } from "../types";

/** One row of the session list returned by `list_*sessions_by_user_id`. */
export interface SessionSummary {
  session_id: string;
  user_id?: string;
  time_stamp: string;
  title: string;
}

interface RawChatEntry {
  user: string;
  chatbot: string;
  metadata?: unknown;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

/** Error carrying whether the failed request is worth repeating. */
class SessionRequestError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = "SessionRequestError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;
}

function parseMetadata(raw: unknown): ChatMessageMetadata {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return { Sources: parsed };
    return parsed && typeof parsed === "object" ? (parsed as ChatMessageMetadata) : {};
  } catch {
    return {};
  }
}

export class SessionsClient {
  private readonly API;
  constructor(protected _appConfig: AppConfig) {
    this.API = _appConfig.httpEndpoint.slice(0, -1);
  }

  /** One POST to /user-session. Throws SessionRequestError on any failure. */
  private async postOnce(
    auth: string,
    body: Record<string, unknown>,
    fallback: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.API + "/user-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // Network failure (offline, DNS, CORS): transient, worth retrying.
      throw new SessionRequestError(`${fallback}: ${Utils.getErrorMessage(error)}`, true);
    }
    if (!response.ok) {
      const message = await Utils.extractServerError(response, fallback);
      throw new SessionRequestError(message, isRetryableStatus(response.status));
    }
    try {
      return await response.json();
    } catch {
      // A truncated body is usually a transient gateway hiccup.
      throw new SessionRequestError(`${fallback}: the server sent an unreadable response`, true);
    }
  }

  /**
   * POST with bounded retries. Only transient failures (network errors, 429,
   * 5xx, unreadable bodies) are retried; a 4xx fails immediately. The last
   * error is rethrown so callers always see a readable message.
   */
  private async post(
    body: Record<string, unknown>,
    fallback: string,
    maxAttempts = MAX_ATTEMPTS,
  ): Promise<unknown> {
    const auth = await Utils.authenticate();
    let lastError: Error = new Error(fallback);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.postOnce(auth, body, fallback);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(Utils.getErrorMessage(error));
        const canRetry = error instanceof SessionRequestError && error.isRetryable;
        if (!canRetry || attempt === maxAttempts) break;
        await Utils.delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
    throw lastError;
  }

  /** Lists the user's sessions (most recent first, as returned by the API). */
  async getSessions(userId: string, all?: boolean): Promise<SessionSummary[]> {
    const operation = all ? "list_all_sessions_by_user_id" : "list_sessions_by_user_id";
    const output = await this.post({ operation, user_id: userId }, "Could not load sessions");
    return Array.isArray(output) ? (output as SessionSummary[]) : [];
  }

  /** Returns the chat history for one session as alternating human/AI items. */
  async getSession(sessionId: string, userId: string): Promise<ChatBotHistoryItem[]> {
    const output = await this.post(
      { operation: "get_session", session_id: sessionId, user_id: userId },
      "Could not load session",
    );
    const entries = (output as { chat_history?: RawChatEntry[] } | null)?.chat_history;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((value) => [
      { type: ChatBotMessageType.Human, content: value.user, metadata: {} },
      { type: ChatBotMessageType.AI, content: value.chatbot, metadata: parseMetadata(value.metadata) },
    ]);
  }

  /**
   * Deletes one session. Throws with a readable message if the delete failed.
   * Not retried: a retry after a 5xx that actually deleted would come back
   * 404 and misreport the outcome.
   */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    await this.post(
      { operation: "delete_session", session_id: sessionId, user_id: userId },
      "Could not delete session",
      1,
    );
  }
}
