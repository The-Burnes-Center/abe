import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionsClient } from "./sessions-client";
import { Utils } from "../utils";
import type { AppConfig } from "../types";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn(), signOut: vi.fn() }));

const config = { httpEndpoint: "https://api.example.test/" } as AppConfig;

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SessionsClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.spyOn(Utils, "authenticate").mockResolvedValue("token");
    vi.spyOn(Utils, "delay").mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("deleteSession", () => {
    it("resolves when the server confirms the delete", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "s1", deleted: true }));
      await expect(new SessionsClient(config).deleteSession("s1", "u1")).resolves.toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ operation: "delete_session", session_id: "s1", user_id: "u1" });
    });

    it("throws a readable string message on a non-OK response", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "User is not authorized" }, "Forbidden"));
      const error = await new SessionsClient(config).deleteSession("s1", "u1").catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("User is not authorized");
      expect(error.message).not.toContain("[object Object]");
    });

    it("falls back to status text when the body has no message", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { id: "s1", deleted: false }, "Not Found"));
      const error = await new SessionsClient(config).deleteSession("s1", "u1").catch((e) => e);
      expect(error.message).toBe("Could not delete session (404 Not Found)");
    });

    it("does not retry a delete, even on a 5xx", async () => {
      fetchMock.mockImplementation(async () => jsonResponse(500, "Failed to delete"));
      await expect(new SessionsClient(config).deleteSession("s1", "u1")).rejects.toThrow("Failed to delete");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSessions", () => {
    it("retries transient failures and returns the list once one succeeds", async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(jsonResponse(503, { message: "Service Unavailable" }))
        .mockResolvedValueOnce(jsonResponse(200, [{ session_id: "a", title: "t", time_stamp: "x" }]));
      const sessions = await new SessionsClient(config).getSessions("u1");
      expect(sessions).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("stops after three attempts and rethrows the last error as a string message", async () => {
      fetchMock.mockImplementation(async () => jsonResponse(500, { error: "database unavailable" }));
      const error = await new SessionsClient(config).getSessions("u1").catch((e) => e);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(typeof error.message).toBe("string");
      expect(error.message).toBe("database unavailable");
    });

    it("does not retry a 4xx", async () => {
      fetchMock.mockImplementation(async () => jsonResponse(400, "Missing user_id"));
      await expect(new SessionsClient(config).getSessions("u1")).rejects.toThrow("Missing user_id");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses the list_all operation when asked for every session", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
      await new SessionsClient(config).getSessions("u1", true);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).operation).toBe("list_all_sessions_by_user_id");
    });
  });

  describe("getSession", () => {
    it("maps chat history into alternating human and AI items", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          chat_history: [{ user: "hi", chatbot: "hello", metadata: JSON.stringify([{ title: "doc" }]) }],
        })
      );
      const history = await new SessionsClient(config).getSession("s1", "u1");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ type: "human", content: "hi" });
      expect(history[1]).toMatchObject({ type: "ai", content: "hello", metadata: { Sources: [{ title: "doc" }] } });
    });
  });
});
