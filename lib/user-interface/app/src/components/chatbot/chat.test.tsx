/**
 * Integration tests for Chat + ChatInputPanel + the real useWebSocketChat.
 * Only the network edges (WebSocket, Amplify, the sessions API) are mocked, so
 * these prove that Stop in the input panel closes the socket opened by the same
 * chat, and that switching sessions cannot leak a stream into the new one.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import Chat from "./chat";
import { AppContext } from "../../common/app-context";
import type { AppConfig } from "../../common/types";

vi.mock("../../hooks/useTranscribeDictation", () => ({
  useTranscribeDictation: () => ({ listening: false, start: vi.fn(), stop: vi.fn(), toggle: vi.fn() }),
  transcribeDictationSupported: () => false,
}));

vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ username: "user-1" }),
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => "id-token", payload: {} } },
  }),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../common/api-client/api-client", () => ({
  ApiClient: class {
    sessions = { getSession: vi.fn().mockResolvedValue([]) };
    userFeedback = { submitFeedback: vi.fn() };
  },
}));

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  closeCalls = 0;
  private listeners: Record<string, ((e: Event) => void)[]> = {};

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  addEventListener(event: string, handler: (e: Event) => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), handler];
  }
  send() {}
  close(code = 1000) {
    this.closeCalls += 1;
    this.readyState = 3;
    this.listeners.close?.forEach((h) => h(new CloseEvent("close", { code })));
  }
  open() {
    this.readyState = 1;
    this.listeners.open?.forEach((h) => h(new Event("open")));
  }
  message(data: string) {
    this.listeners.message?.forEach((h) => h(new MessageEvent("message", { data })));
  }
}

const config: AppConfig = {
  Auth: { region: "us-east-1", userPoolId: "us-east-1_x", userPoolWebClientId: "c" },
  httpEndpoint: "https://api.example.com/",
  wsEndpoint: "wss://ws.example.com",
};

function renderChat(sessionId: string) {
  return render(
    <AppContext.Provider value={config}>
      <Chat key={sessionId} sessionId={sessionId} />
    </AppContext.Provider>
  );
}

async function sendMessage(text: string) {
  const textarea = await screen.findByRole("textbox");
  await waitFor(() => expect(screen.queryByLabelText(/loading conversation/i)).not.toBeInTheDocument());
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
  await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  act(() => ws.open());
  return ws;
}

describe("Chat streaming lifecycle", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Stop in the input panel closes the socket the chat opened", async () => {
    renderChat("session-a");
    const ws = await sendMessage("Hello");
    act(() => ws.message("Partial answer"));

    fireEvent.click(screen.getByRole("button", { name: /stop response/i }));

    expect(ws.closeCalls).toBe(1);
    expect(ws.readyState).toBe(3);
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
    // Frames that race in after Stop are ignored.
    act(() => ws.message(" more text"));
    expect(screen.queryByText(/more text/)).not.toBeInTheDocument();
  });

  it("switching sessions mid-stream aborts the old stream and isolates the new chat", async () => {
    const view = renderChat("session-a");
    const ws = await sendMessage("Question for A");
    act(() => ws.message("Answer for A"));
    expect(await screen.findByText(/Answer for A/)).toBeInTheDocument();

    view.rerender(
      <AppContext.Provider value={config}>
        <Chat key="session-b" sessionId="session-b" />
      </AppContext.Provider>
    );

    expect(ws.readyState).toBe(3);
    act(() => ws.message(" still streaming A"));
    await waitFor(() => expect(screen.queryByText(/Answer for A/)).not.toBeInTheDocument());
    expect(screen.queryByText(/still streaming A/)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /send message/i })).toBeInTheDocument();
  });
});
