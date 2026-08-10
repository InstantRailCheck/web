// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchlistDashboard } from "./WatchlistDashboard";

const getWatchlistMock = vi.fn();
const unfollowBankMock = vi.fn().mockResolvedValue({ success: true });
const unfollowRouteMock = vi.fn().mockResolvedValue({ success: true });
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/getWatchlist", () => ({
  getWatchlist: (...args: unknown[]) => getWatchlistMock(...args),
}));
vi.mock("@/lib/actions/unfollowBank", () => ({
  unfollowBank: (...args: unknown[]) => unfollowBankMock(...args),
}));
vi.mock("@/lib/actions/unfollowRoute", () => ({
  unfollowRoute: (...args: unknown[]) => unfollowRouteMock(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: currentUser } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));

const sampleBank = {
  bankId: "bank-a",
  bankName: "Wells Fargo",
  bankSlug: "wells-fargo",
  bankIsActive: true,
  followedAt: "2026-08-01T00:00:00Z",
};

const sampleRoute = {
  fromBankId: "bank-a",
  fromBankName: "Wells Fargo",
  fromBankSlug: "wells-fargo",
  fromBankIsActive: true,
  toBankId: "bank-b",
  toBankName: "Chase",
  toBankSlug: "chase",
  toBankIsActive: false,
  followedAt: "2026-08-02T00:00:00Z",
};

beforeEach(() => {
  currentUser = { id: "user-1" };
  getWatchlistMock.mockReset();
  getWatchlistMock.mockResolvedValue({ banks: [], routes: [] });
  unfollowBankMock.mockClear();
  unfollowBankMock.mockResolvedValue({ success: true });
  unfollowRouteMock.mockClear();
  unfollowRouteMock.mockResolvedValue({ success: true });
});

describe("WatchlistDashboard", () => {
  it("shows a sign-in prompt when signed out and never calls getWatchlist", async () => {
    currentUser = null;
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByText("Sign in to see your watchlist."));
    expect(getWatchlistMock).not.toHaveBeenCalled();
  });

  it("shows empty-state messages when nothing is followed", async () => {
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByText("You're not following any banks yet."));
    expect(screen.getByText("You're not watching any routes yet.")).toBeInTheDocument();
  });

  it("lists followed banks and routes, labeling an inactive bank truthfully", async () => {
    getWatchlistMock.mockResolvedValue({ banks: [sampleBank], routes: [sampleRoute] });
    render(<WatchlistDashboard />);

    // "Wells Fargo" appears once in the Banks list and once in the Routes
    // list here (it's both the followed bank and the route's sender).
    await waitFor(() => expect(screen.getAllByText("Wells Fargo")).toHaveLength(2));
    expect(screen.getAllByRole("link", { name: "Wells Fargo" })[0]).toHaveAttribute("href", "/banks/wells-fargo");
    expect(screen.getByText("One or both banks are no longer active")).toBeInTheDocument();
  });

  it("removes a bank from the list after a successful unfollow", async () => {
    getWatchlistMock.mockResolvedValue({ banks: [sampleBank], routes: [] });
    const user = userEvent.setup();
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByText("Wells Fargo"));

    await user.click(screen.getByRole("button", { name: "Unfollow" }));

    await waitFor(() => expect(unfollowBankMock).toHaveBeenCalledWith("bank-a"));
    await waitFor(() => screen.getByText("You're not following any banks yet."));
  });

  it("removes a route from the list after a successful unwatch", async () => {
    getWatchlistMock.mockResolvedValue({ banks: [], routes: [sampleRoute] });
    const user = userEvent.setup();
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByRole("button", { name: "Unwatch" }));

    await user.click(screen.getByRole("button", { name: "Unwatch" }));

    await waitFor(() => expect(unfollowRouteMock).toHaveBeenCalledWith("bank-a", "bank-b"));
    await waitFor(() => screen.getByText("You're not watching any routes yet."));
  });

  it("shows an error and keeps the item when getWatchlist fails", async () => {
    getWatchlistMock.mockResolvedValue({ error: "Failed to load your watchlist." });
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByText("Failed to load your watchlist."));
  });

  it("shows an error and does not remove the item when unfollow fails", async () => {
    getWatchlistMock.mockResolvedValue({ banks: [sampleBank], routes: [] });
    unfollowBankMock.mockResolvedValue({ error: "Failed to unfollow this bank." });
    const user = userEvent.setup();
    render(<WatchlistDashboard />);
    await waitFor(() => screen.getByText("Wells Fargo"));

    await user.click(screen.getByRole("button", { name: "Unfollow" }));

    await waitFor(() => screen.getByText("Failed to unfollow this bank."));
    expect(screen.getByText("Wells Fargo")).toBeInTheDocument();
  });
});
