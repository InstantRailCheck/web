// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestRouteButton } from "./RequestRouteButton";

const requestRouteMock = vi.fn().mockResolvedValue({ success: true });
const refreshMock = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/actions/requestRoute", () => ({
  requestRoute: (...args: unknown[]) => requestRouteMock(...args),
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
  requestRouteMock.mockClear();
  requestRouteMock.mockResolvedValue({ success: true });
  refreshMock.mockClear();
});

describe("RequestRouteButton", () => {
  it("renders distinct copy from a report action", async () => {
    render(<RequestRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Request this route" }));
    expect(screen.queryByText(/report/i)).not.toBeInTheDocument();
  });

  it("calls requestRoute with the given bank ids, shows confirmation, and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<RequestRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Request this route" }));

    await user.click(screen.getByRole("button", { name: "Request this route" }));

    await waitFor(() => expect(requestRouteMock).toHaveBeenCalledWith("bank-a", "bank-b"));
    await waitFor(() => screen.getByText("Requested ✓"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Request this route" })).not.toBeInTheDocument();
  });

  it("shows the returned error message and does not refresh on failure", async () => {
    const user = userEvent.setup();
    requestRouteMock.mockResolvedValue({ error: "Too many requests submitted recently." });
    render(<RequestRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Request this route" }));

    await user.click(screen.getByRole("button", { name: "Request this route" }));

    await waitFor(() => screen.getByText("Too many requests submitted recently."));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("opens the sign-in prompt instead of calling requestRoute when signed out", async () => {
    currentUser = null;
    const user = userEvent.setup();
    render(<RequestRouteButton fromBankId="bank-a" toBankId="bank-b" />);
    await waitFor(() => screen.getByRole("button", { name: "Request this route" }));

    await user.click(screen.getByRole("button", { name: "Request this route" }));

    expect(requestRouteMock).not.toHaveBeenCalled();
    await screen.findByRole("dialog");
  });
});
