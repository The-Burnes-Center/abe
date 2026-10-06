import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DemoVideo from "./demo-video";
import HelpPage from "../../pages/help/how-to-use";
import { resetVideoProbeCache } from "./use-video-available";
import { brand } from "../../common/brand";

const fetchMock = vi.fn();

function headResponse(status: number, contentType: string) {
  return new Response(null, { status, headers: { "content-type": contentType } });
}

beforeEach(() => {
  resetVideoProbeCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoVideo", () => {
  it("probes the brand demo clip by default", async () => {
    fetchMock.mockResolvedValue(headResponse(404, "text/plain"));
    render(<DemoVideo />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(brand.assets.demoVideo, { method: "HEAD" }));
  });

  it("renders nothing and reports unavailable when the clip is missing", async () => {
    fetchMock.mockResolvedValue(headResponse(404, "text/plain"));
    const onUnavailable = vi.fn();
    const { container } = render(<DemoVideo src="/demos/missing.mp4" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(container.querySelector("video")).toBeNull();
  });

  it("treats an SPA index.html fallback as missing", async () => {
    fetchMock.mockResolvedValue(headResponse(200, "text/html; charset=utf-8"));
    const onUnavailable = vi.fn();
    const { container } = render(<DemoVideo src="/demos/fallback.mp4" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(container.querySelector("video")).toBeNull();
  });

  it("renders the clip when it exists, and removes it if it then fails to load", async () => {
    fetchMock.mockResolvedValue(headResponse(200, "video/mp4"));
    const onUnavailable = vi.fn();
    const { container } = render(<DemoVideo src="/demos/ok.mp4" onUnavailable={onUnavailable} />);
    const video = await waitFor(() => {
      const el = container.querySelector("video");
      expect(el).not.toBeNull();
      return el as HTMLVideoElement;
    });
    expect(onUnavailable).not.toHaveBeenCalled();

    fireEvent.error(video);

    expect(container.querySelector("video")).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});

describe("Help page demo card", () => {
  const cardHeading = `See ${brand.shortName} in action`;

  function renderHelp() {
    return render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
  }

  it("hides the card when the deployment has no demo clip", async () => {
    fetchMock.mockResolvedValue(headResponse(404, "text/plain"));
    renderHelp();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /prompting tips/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: cardHeading })).toBeNull();
  });

  it("shows the card when the clip exists", async () => {
    fetchMock.mockResolvedValue(headResponse(200, "video/mp4"));
    renderHelp();
    expect(await screen.findByRole("heading", { name: cardHeading })).toBeInTheDocument();
  });
});
