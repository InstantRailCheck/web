// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WatchlistActivityBadge } from "./WatchlistActivityBadge";

const getWatchlistActivityCountMock = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/getWatchlistActivityCount", () => ({
  getWatchlistActivityCount: (...args: unknown[]) => getWatchlistActivityCountMock(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: currentUser } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

beforeEach(() => {
  currentUser = { id: "user-1" };
  getWatchlistActivityCountMock.mockReset();
  getWatchlistActivityCountMock.mockResolvedValue({ count: 0 });
});

describe("WatchlistActivityBadge", () => {
  it("renders nothing when signed out and never calls getWatchlistActivityCount", async () => {
    currentUser = null;
    const { container } = render(<WatchlistActivityBadge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(getWatchlistActivityCountMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the count is zero", async () => {
    const { container } = render(<WatchlistActivityBadge />);
    await waitFor(() => expect(getWatchlistActivityCountMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the unread count linking to /account", async () => {
    getWatchlistActivityCountMock.mockResolvedValue({ count: 3 });
    render(<WatchlistActivityBadge />);

    await waitFor(() => screen.getByText("3"));
    expect(screen.getByRole("link")).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link")).toHaveAttribute("aria-label", "3 new updates on your watchlist");
  });

  it("caps the displayed count at 9+", async () => {
    getWatchlistActivityCountMock.mockResolvedValue({ count: 42 });
    render(<WatchlistActivityBadge />);

    await waitFor(() => screen.getByText("9+"));
  });

  it("renders nothing when the count fetch errors", async () => {
    getWatchlistActivityCountMock.mockResolvedValue({ error: "You must be signed in." });
    const { container } = render(<WatchlistActivityBadge />);
    await waitFor(() => expect(getWatchlistActivityCountMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
