// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchRouteButton } from "./WatchRouteButton";

const followRouteMock = vi.fn().mockResolvedValue({ success: true });
const unfollowRouteMock = vi.fn().mockResolvedValue({ success: true });
const getRouteFollowStatusMock = vi.fn().mockResolvedValue({ following: false });
const refreshMock = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/followRoute", () => ({
  followRoute: (...args: unknown[]) => followRouteMock(...args),
}));
vi.mock("@/lib/actions/unfollowRoute", () => ({
  unfollowRoute: (...args: unknown[]) => unfollowRouteMock(...args),
}));
vi.mock("@/lib/actions/getRouteFollowStatus", () => ({
  getRouteFollowStatus: (...args: unknown[]) => getRouteFollowStatusMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
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
  followRouteMock.mockClear();
  followRouteMock.mockResolvedValue({ success: true });
  unfollowRouteMock.mockClear();
  unfollowRouteMock.mockResolvedValue({ success: true });
  getRouteFollowStatusMock.mockClear();
  getRouteFollowStatusMock.mockResolvedValue({ following: false });
  refreshMock.mockClear();
});

describe("WatchRouteButton", () => {
  it("shows 'Watch this route' when not already watching", async () => {
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watch this route" }));
  });

  it("shows 'Watching' when already watching, from the initial status check", async () => {
    getRouteFollowStatusMock.mockResolvedValue({ following: true });
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watching" }));
  });

  it("calls followRoute with both bank ids and flips to Watching on click", async () => {
    const user = userEvent.setup();
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watch this route" }));

    await user.click(screen.getByRole("button", { name: "Watch this route" }));

    await waitFor(() => expect(followRouteMock).toHaveBeenCalledWith("bank-a", "bank-b"));
    await waitFor(() => screen.getByRole("button", { name: "Watching" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("calls unfollowRoute and flips back when already watching", async () => {
    getRouteFollowStatusMock.mockResolvedValue({ following: true });
    const user = userEvent.setup();
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watching" }));

    await user.click(screen.getByRole("button", { name: "Watching" }));

    await waitFor(() => expect(unfollowRouteMock).toHaveBeenCalledWith("bank-a", "bank-b"));
    await waitFor(() => screen.getByRole("button", { name: "Watch this route" }));
  });

  it("shows the returned error message and does not toggle on failure", async () => {
    const user = userEvent.setup();
    followRouteMock.mockResolvedValue({ error: "Too many requests." });
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watch this route" }));

    await user.click(screen.getByRole("button", { name: "Watch this route" }));

    await waitFor(() => screen.getByText("Too many requests."));
  });

  it("opens the sign-in prompt instead of calling followRoute when signed out", async () => {
    currentUser = null;
    const user = userEvent.setup();
    render(<WatchRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Watch this route" }));

    await user.click(screen.getByRole("button", { name: "Watch this route" }));

    expect(followRouteMock).not.toHaveBeenCalled();
    await screen.findByRole("dialog");
  });
});
