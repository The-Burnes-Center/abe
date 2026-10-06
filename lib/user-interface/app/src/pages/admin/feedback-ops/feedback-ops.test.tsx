import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import FeedbackOpsPage from "./index";
import { AppContext } from "../../../common/app-context";
import { NotificationContext } from "../../../components/notif-manager";
import type { AppConfig } from "../../../common/types";

const userFeedback = vi.hoisted(() => ({
  getAdminFeedback: vi.fn(),
  getMonitoring: vi.fn(),
  getPrompts: vi.fn(),
  getActivityLog: vi.fn(),
}));

vi.mock("../../../common/api-client/api-client", () => ({
  ApiClient: class {
    userFeedback = userFeedback;
  },
}));

const config: AppConfig = {
  Auth: { region: "us-east-1", userPoolId: "us-east-1_x", userPoolWebClientId: "c" },
  httpEndpoint: "https://api.example.com/",
  wsEndpoint: "wss://ws.example.com",
};

function renderPage(initialPath = "/admin/user-feedback") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppContext.Provider value={config}>
        <NotificationContext.Provider
          value={{ notifications: [], addNotification: vi.fn(), removeNotification: vi.fn() }}
        >
          <FeedbackOpsPage />
        </NotificationContext.Provider>
      </AppContext.Provider>
    </MemoryRouter>
  );
}

describe("FeedbackOpsPage load errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFeedback.getMonitoring.mockResolvedValue(null);
    userFeedback.getPrompts.mockResolvedValue({ items: [], liveVersionId: null });
    userFeedback.getActivityLog.mockResolvedValue({ entries: [] });
  });

  it("shows an error with Retry instead of the empty state when feedback fails to load", async () => {
    userFeedback.getAdminFeedback
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce({ items: [] });

    renderPage();

    expect(await screen.findByText("Feedback could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs your review")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(userFeedback.getAdminFeedback).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nothing needs your review")).toBeInTheDocument();
    expect(screen.queryByText("Feedback could not be loaded")).toBeNull();
  });

  it("shows an error with Retry on the Trends tab when monitoring fails to load", async () => {
    userFeedback.getAdminFeedback.mockResolvedValue({ items: [] });
    userFeedback.getMonitoring.mockRejectedValue(new Error("Trends unavailable"));

    renderPage("/admin/user-feedback?tab=trends");

    expect(await screen.findByText("Trends could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No trend data yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(userFeedback.getMonitoring).toHaveBeenCalledTimes(2));
  });

  it("does not offer to start a draft when instructions fail to load", async () => {
    userFeedback.getAdminFeedback.mockResolvedValue({ items: [] });
    userFeedback.getPrompts.mockRejectedValue(new Error("Prompts unavailable"));

    renderPage("/admin/user-feedback?tab=prompts");

    expect(await screen.findByText("Instructions could not be loaded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit a copy/i })).toBeNull();
  });
});
