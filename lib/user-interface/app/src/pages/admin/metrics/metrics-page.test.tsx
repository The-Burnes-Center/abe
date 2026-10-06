import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MetricsPage from "../metrics-page";
import { AppContext } from "../../../common/app-context";
import type { AppConfig } from "../../../common/types";
import type { MetricsOverview } from "../../../common/api-client/metrics-client";

const metrics = vi.hoisted(() => ({
  getMetrics: vi.fn(),
  getFAQInsights: vi.fn(),
  getUserBreakdown: vi.fn(),
}));

vi.mock("../../../common/api-client/api-client", () => ({
  ApiClient: class {
    metrics = metrics;
  },
}));

const config: AppConfig = {
  Auth: { region: "us-east-1", userPoolId: "us-east-1_x", userPoolWebClientId: "c" },
  httpEndpoint: "https://api.example.com/",
  wsEndpoint: "wss://ws.example.com",
};

const OVERVIEW: MetricsOverview = {
  unique_users: 3,
  total_sessions: 5,
  total_messages: 12,
  avg_messages_per_session: 2.4,
  peak_hour: "N/A",
  daily_breakdown: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/metrics"]}>
      <AppContext.Provider value={config}>
        <MetricsPage />
      </AppContext.Provider>
    </MemoryRouter>
  );
}

describe("MetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metrics.getFAQInsights.mockResolvedValue({ topics: [], total_classified: 0 });
    metrics.getUserBreakdown.mockResolvedValue({ users: [], total_messages: 0 });
  });

  it("shows the server error with a Retry button, and Retry reloads the data", async () => {
    metrics.getMetrics
      .mockRejectedValueOnce(new Error("Forbidden: Admin access required"))
      .mockResolvedValueOnce(OVERVIEW);

    renderPage();

    expect(await screen.findByText("Forbidden: Admin access required")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByText("Forbidden: Admin access required")).not.toBeInTheDocument();
    expect(metrics.getMetrics).toHaveBeenCalledTimes(2);
  });

  it("renders the tabs without any agency tab when metrics load", async () => {
    metrics.getMetrics.mockResolvedValue(OVERVIEW);

    renderPage();

    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "By User" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /agency/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/agency/i)).not.toBeInTheDocument();
  });
});
