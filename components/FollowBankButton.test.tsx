// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FollowBankButton } from "./FollowBankButton";

const followBankMock = vi.fn().mockResolvedValue({ success: true });
const unfollowBankMock = vi.fn().mockResolvedValue({ success: true });
const getBankFollowStatusMock = vi.fn().mockResolvedValue({ following: false });
const refreshMock = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/followBank", () => ({
  followBank: (...args: unknown[]) => followBankMock(...args),
}));
vi.mock("@/lib/actions/unfollowBank", () => ({
  unfollowBank: (...args: unknown[]) => unfollowBankMock(...args),
}));
vi.mock("@/lib/actions/getBankFollowStatus", () => ({
  getBankFollowStatus: (...args: unknown[]) => getBankFollowStatusMock(...args),
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
  followBankMock.mockClear();
  followBankMock.mockResolvedValue({ success: true });
  unfollowBankMock.mockClear();
  unfollowBankMock.mockResolvedValue({ success: true });
  getBankFollowStatusMock.mockClear();
  getBankFollowStatusMock.mockResolvedValue({ following: false });
  refreshMock.mockClear();
});

describe("FollowBankButton", () => {
  it("shows 'Follow this bank' when not already following", async () => {
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByRole("button", { name: "Follow Wells Fargo" }));
    expect(screen.getByText("Follow this bank")).toBeInTheDocument();
  });

  it("shows 'Following' when already following, from the initial status check", async () => {
    getBankFollowStatusMock.mockResolvedValue({ following: true });
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByRole("button", { name: "Unfollow Wells Fargo" }));
    expect(screen.getByText("Following")).toBeInTheDocument();
  });

  it("calls followBank and flips to Following on click", async () => {
    const user = userEvent.setup();
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByRole("button", { name: "Follow Wells Fargo" }));

    await user.click(screen.getByRole("button", { name: "Follow Wells Fargo" }));

    await waitFor(() => expect(followBankMock).toHaveBeenCalledWith("bank-a"));
    await waitFor(() => screen.getByText("Following"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("calls unfollowBank and flips back when already following", async () => {
    getBankFollowStatusMock.mockResolvedValue({ following: true });
    const user = userEvent.setup();
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByText("Following"));

    await user.click(screen.getByRole("button", { name: "Unfollow Wells Fargo" }));

    await waitFor(() => expect(unfollowBankMock).toHaveBeenCalledWith("bank-a"));
    await waitFor(() => screen.getByText("Follow this bank"));
  });

  it("shows the returned error message and does not toggle on failure", async () => {
    const user = userEvent.setup();
    followBankMock.mockResolvedValue({ error: "Too many requests." });
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByRole("button", { name: "Follow Wells Fargo" }));

    await user.click(screen.getByRole("button", { name: "Follow Wells Fargo" }));

    await waitFor(() => screen.getByText("Too many requests."));
    expect(screen.getByText("Follow this bank")).toBeInTheDocument();
  });

  it("opens the sign-in prompt instead of calling followBank when signed out", async () => {
    currentUser = null;
    const user = userEvent.setup();
    render(<FollowBankButton bankId="bank-a" bankName="Wells Fargo" />);
    await waitFor(() => screen.getByRole("button", { name: "Follow Wells Fargo" }));

    await user.click(screen.getByRole("button", { name: "Follow Wells Fargo" }));

    expect(followBankMock).not.toHaveBeenCalled();
    await screen.findByRole("dialog");
  });
});
