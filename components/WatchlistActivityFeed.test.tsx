// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WatchlistActivityFeed } from "./WatchlistActivityFeed";

const getWatchlistActivityMock = vi.fn();
const markWatchlistActivitySeenMock = vi.fn().mockResolvedValue({ success: true });
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/getWatchlistActivity", () => ({
  getWatchlistActivity: (...args: unknown[]) => getWatchlistActivityMock(...args),
}));
vi.mock("@/lib/actions/markWatchlistActivitySeen", () => ({
  markWatchlistActivitySeen: (...args: unknown[]) => markWatchlistActivitySeenMock(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: currentUser } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

const sampleItem = {
  key: "bank-a::bank-b::RTP",
  fromBankId: "bank-a",
  fromBankSlug: "wells-fargo",
  fromBankName: "Wells Fargo",
  toBankId: "bank-b",
  toBankSlug: "chase",
  toBankName: "Chase",
  rail: "RTP",
  changeLabel: "Newly confirmed working",
  latestReportAt: new Date(Date.now() - 3600_000).toISOString(),
};

beforeEach(() => {
  currentUser = { id: "user-1" };
  getWatchlistActivityMock.mockReset();
  getWatchlistActivityMock.mockResolvedValue({ items: [] });
  markWatchlistActivitySeenMock.mockClear();
  markWatchlistActivitySeenMock.mockResolvedValue({ success: true });
});

describe("WatchlistActivityFeed", () => {
  it("renders nothing when signed out and never calls getWatchlistActivity", async () => {
    currentUser = null;
    const { container } = render(<WatchlistActivityFeed />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(getWatchlistActivityMock).not.toHaveBeenCalled();
  });

  it("shows an empty-state message when there's no new activity", async () => {
    render(<WatchlistActivityFeed />);
    await waitFor(() => screen.getByText("No new activity on your watchlist yet."));
  });

  it("lists an activity item with its change label, rail, and links", async () => {
    getWatchlistActivityMock.mockResolvedValue({ items: [sampleItem] });
    render(<WatchlistActivityFeed />);

    await waitFor(() => screen.getByText("Newly confirmed working"));
    expect(screen.getByRole("link", { name: "Wells Fargo" })).toHaveAttribute("href", "/banks/wells-fargo");
    expect(screen.getByRole("link", { name: "View route" })).toHaveAttribute(
      "href",
      "/?from=wells-fargo&to=chase#search"
    );
    expect(screen.getByRole("link", { name: "Contribute an update" })).toHaveAttribute(
      "href",
      "/?from=wells-fargo&to=chase#submit-route-report"
    );
  });

  it("marks the feed seen only after the fetch resolves", async () => {
    getWatchlistActivityMock.mockResolvedValue({ items: [sampleItem] });
    render(<WatchlistActivityFeed />);

    await waitFor(() => screen.getByText("Newly confirmed working"));
    expect(markWatchlistActivitySeenMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the fetch fails", async () => {
    getWatchlistActivityMock.mockResolvedValue({ error: "Failed to load your watchlist." });
    render(<WatchlistActivityFeed />);
    await waitFor(() => screen.getByText("Failed to load your watchlist."));
  });
});
