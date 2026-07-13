// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestRouteForm } from "./RequestRouteForm";

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

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };

function mockBankSearch(banks: Array<{ id: string; slug: string; name: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ banks }), { status: 200 }))
  );
}

async function pickBank(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, bankName: string) {
  await user.click(screen.getByRole("combobox", { name: fieldLabel }));
  await user.click(await screen.findByRole("option", { name: bankName }));
}

beforeEach(() => {
  currentUser = { id: "user-1" };
  requestRouteMock.mockClear();
  requestRouteMock.mockResolvedValue({ success: true });
  refreshMock.mockClear();
  mockBankSearch([BANK_A, BANK_B]);
});

describe("RequestRouteForm", () => {
  it("prompts sign-in instead of showing the bank pickers when signed out", async () => {
    currentUser = null;
    render(<RequestRouteForm />);

    await screen.findByRole("button", { name: "Sign in to request a route" });
    expect(screen.queryByRole("combobox", { name: "From bank" })).not.toBeInTheDocument();
  });

  it("rejects submission when the same bank is picked on both sides", async () => {
    const user = userEvent.setup();
    render(<RequestRouteForm />);
    await waitFor(() => screen.getByRole("combobox", { name: "From bank" }));

    await pickBank(user, "From bank", BANK_A.name);
    await pickBank(user, "To bank", BANK_A.name);
    await user.click(screen.getByRole("button", { name: "Request this route" }));

    await waitFor(() => screen.getByText("Sender and receiver banks must be different."));
    expect(requestRouteMock).not.toHaveBeenCalled();
  });

  it("submits both bank ids, shows confirmation, clears the form, and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<RequestRouteForm />);
    await waitFor(() => screen.getByRole("combobox", { name: "From bank" }));

    await pickBank(user, "From bank", BANK_A.name);
    await pickBank(user, "To bank", BANK_B.name);
    await user.click(screen.getByRole("button", { name: "Request this route" }));

    await waitFor(() => expect(requestRouteMock).toHaveBeenCalledWith(BANK_A.id, BANK_B.id));
    await waitFor(() => screen.getByText("Request submitted — thank you!"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "From bank" })).not.toHaveTextContent(BANK_A.name);
  });

  it("surfaces a returned error without refreshing", async () => {
    const user = userEvent.setup();
    requestRouteMock.mockResolvedValue({ error: "Too many requests submitted recently." });
    render(<RequestRouteForm />);
    await waitFor(() => screen.getByRole("combobox", { name: "From bank" }));

    await pickBank(user, "From bank", BANK_A.name);
    await pickBank(user, "To bank", BANK_B.name);
    await user.click(screen.getByRole("button", { name: "Request this route" }));

    await waitFor(() => screen.getByText("Too many requests submitted recently."));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
