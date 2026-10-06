import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import ChatInputPanel, { type ChatInputPanelProps } from "./chat-input-panel";
import { NotificationContext } from "../notif-manager";
import type { SendOptions } from "../../hooks/useWebSocketChat";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../hooks/useTranscribeDictation", () => ({
  useTranscribeDictation: () => ({
    listening: false,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  }),
  transcribeDictationSupported: () => false,
}));

vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ username: "test-user" }),
}));

vi.mock("../../common/utils", () => ({
  Utils: {
    delay: vi.fn().mockResolvedValue(undefined),
    redirectToLogin: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<ChatInputPanelProps> = {}): ChatInputPanelProps {
  return {
    running: false,
    setRunning: vi.fn(),
    session: { id: "session-1", loading: false },
    messageHistory: [],
    setMessageHistory: vi.fn(),
    streamingStatus: { text: "", active: false },
    setStreamingStatus: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWithNotifications(ui: React.ReactElement, addNotification = vi.fn()) {
  return render(
    <NotificationContext.Provider
      value={{ notifications: [], addNotification, removeNotification: vi.fn() }}
    >
      {ui}
    </NotificationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatInputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("send button is disabled when the textarea is empty", () => {
    renderWithNotifications(<ChatInputPanel {...makeProps()} />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("shows the stop button (not send) while a response is running", () => {
    renderWithNotifications(<ChatInputPanel {...makeProps({ running: true })} />);
    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop response/i })).toBeInTheDocument();
  });

  it("shows an error notification when Enter is pressed with an empty textarea", async () => {
    const addNotification = vi.fn();
    renderWithNotifications(<ChatInputPanel {...makeProps()} />, addNotification);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith("error", "Type a message before sending.");
    });
  });

  it("sends through the shared send prop without identity fields", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    renderWithNotifications(<ChatInputPanel {...makeProps({ send })} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });

    await waitFor(() => expect(send).toHaveBeenCalled());
    const opts = send.mock.calls[0][0] as SendOptions & Record<string, unknown>;
    expect(opts.userMessage).toBe("Hello");
    expect(opts.userId).toBe("test-user");
    expect(opts).not.toHaveProperty("agency");
    expect(opts).not.toHaveProperty("displayName");
  });

  it("puts the typed text back in the box when sending fails", async () => {
    const send = vi.fn(async (opts: SendOptions) => opts.onError("Connection lost."));
    const addNotification = vi.fn();
    renderWithNotifications(<ChatInputPanel {...makeProps({ send })} />, addNotification);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "What is the policy?" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => expect(textarea.value).toBe("What is the policy?"));
    expect(addNotification).toHaveBeenCalledWith("error", expect.stringContaining("Connection lost."));
  });
});
